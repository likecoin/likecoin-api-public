import { Router } from 'express';
import {
  checkArweaveTxV2,
  estimateUploadToArweaveV2,
  pushArweaveSingleFileToIPFS,
} from '../../util/api/arweave';
import publisher from '../../util/gcloudPub';
import { API_HOSTNAME, ARWEAVE_GATEWAY, PUBSUB_TOPIC_MISC } from '../../constant';
import {
  ARWEAVE_EVM_TARGET_ADDRESS,
  ARWEAVE_LINK_INTERNAL_TOKEN,
} from '../../../config/config';
import { getPublicKey, fund as fundIrys, signData as signArweaveData } from '../../util/arweave/signer';
import {
  createNewArweaveTx, getArweaveTxInfo, updateArweaveTxStatus, rotateArweaveTxAccessToken,
} from '../../util/api/arweave/tx';
import { jwtAuth, jwtOptionalAuth } from '../../middleware/jwt';
import { ValidationError } from '../../util/ValidationError';

const router = Router();

router.get(
  '/v2/public_key',
  async (req, res, next) => {
    try {
      const publicKey = await getPublicKey();
      res.json({ publicKey: publicKey.toString('base64') });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/v2/estimate',
  async (req, res, next) => {
    try {
      const { fileSize, ipfsHash } = req.body;
      if (!fileSize) throw new Error('MISSING_FILE_SIZE');
      const {
        arweaveId,
        ETH,
      } = await estimateUploadToArweaveV2(fileSize, ipfsHash);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveEstimateV2',
        ipfsHash,
        arweaveId,
        ETH,
      });
      res.json({
        arweaveId,
        ETH,
        memo: JSON.stringify({ ipfs: ipfsHash, fileSize }),
        evmAddress: ARWEAVE_EVM_TARGET_ADDRESS,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/v2/sign_payment_data',
  jwtOptionalAuth('write:iscn'),
  async (req, res, next) => {
    try {
      const {
        fileSize, ipfsHash, txHash, signatureData, txToken = 'BASEETH',
      } = req.body;
      if (!txHash) throw new Error('MISSING_TX_HASH');
      if (!ipfsHash) throw new Error('MISSING_IPFS_HASH');
      if (!fileSize) throw new Error('MISSING_FILE_SIZE');
      if (!signatureData) throw new Error('MISSING_SIGNATURE_DATA');
      if (!['BASEETH'].includes(txToken)) throw new Error('INVALID_TX_TOKEN');

      const estimate = await estimateUploadToArweaveV2(
        fileSize,
        ipfsHash,
        { margin: 0, checkDuplicate: false },
      );
      const {
        ETH,
        arweaveId,
        isExists,
      } = estimate;

      await checkArweaveTxV2({
        fileSize, ipfsHash, txHash, ETH, txToken,
      });

      let token;
      try {
        token = await createNewArweaveTx(txHash, {
          ipfsHash,
          fileSize,
          ownerWallet: req.user?.wallet || '',
        });
      } catch (error) {
        if ((error as Error)?.message.includes('ALREADY_EXISTS')) {
          // eslint-disable-next-line no-console
          console.warn(error);
          res.status(429).send('TX_HASH_ALREADY_USED');
          return;
        }
        throw error;
      }

      if (ETH && ETH !== '0') {
        await fundIrys(ETH);
      }

      // TODO: verify signatureData match filesize if possible
      const signature = await signArweaveData(Buffer.from(signatureData, 'base64'));
      const signatureHex = signature && signature.toString('base64');

      res.json({
        token,
        id: txHash,
        arweaveId,
        isExists,
        signature: signatureHex,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveSigningV2',
        ipfsHash,
        arweaveId,
        ETH,
        txHash,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/v2/register',
  jwtOptionalAuth('write:iscn'),
  async (req, res, next) => {
    try {
      const {
        txHash, arweaveId, token, key, isRequireAuth = true,
      } = req.body;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      if (!arweaveId) throw new ValidationError('MISSING_ARWEAVE_ID');
      if (isRequireAuth && !req.user?.wallet) throw new ValidationError('MISSING_USER', 401);
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      const { ownerWallet, authToken } = tx;
      const userWallet = req.user?.wallet || '';
      const isAuthed = (ownerWallet && userWallet === ownerWallet)
        || (authToken && authToken === token);
      if (!isAuthed) throw new ValidationError('INVALID_TOKEN', 403);
      if (tx.status !== 'pending') throw new ValidationError('TX_ALREADY_REGISTERED', 409);
      const accessToken = await updateArweaveTxStatus(txHash, {
        arweaveId,
        ownerWallet: req.user?.wallet || '',
        key,
        isRequireAuth,
      });
      res.json({
        link: `https://${API_HOSTNAME}/arweave/v2/link/${txHash}`,
        token,
        accessToken,
        isRequireAuth,
      });
      const {
        ipfsHash, fileSize,
      } = tx;
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveIdRegisterStartV2',
        ipfsHash,
        arweaveId,
        txHash,
      });
      await pushArweaveSingleFileToIPFS({ arweaveId, ipfsHash, fileSize });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveIdRegisterCompleteV2',
        ipfsHash,
        arweaveId,
        txHash,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/v2/link/:txHash',
  jwtOptionalAuth('read:iscn'),
  async (req, res, next) => {
    try {
      const { txHash } = req.params;
      const { token } = req.query;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      const {
        arweaveId, token: docToken, isRequireAuth, ownerWallet, key,
        accessToken: docAccessToken,
      } = tx;
      if (isRequireAuth) {
        if (!req.user?.wallet && !token) throw new ValidationError('MISSING_USER', 401);
        const isUserAuthed = req.user?.wallet === ownerWallet;
        const isTokenAuthed = token === docToken
          || (ARWEAVE_LINK_INTERNAL_TOKEN && token === ARWEAVE_LINK_INTERNAL_TOKEN)
          || (docAccessToken && token === docAccessToken);
        if (!isUserAuthed && !isTokenAuthed) throw new ValidationError('INVALID_TOKEN', 403);
      }
      const link = new URL(`${ARWEAVE_GATEWAY}/${arweaveId}`);
      if (key) {
        link.searchParams.set('key', key);
      }
      if (req.accepts('application/json')) {
        res.json({
          arweaveId,
          txHash,
          key,
          link: link.toString(),
        });
        return;
      }
      res.redirect(link.toString());
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/v2/access_token/:txHash',
  jwtAuth('write:iscn'),
  async (req, res, next) => {
    try {
      const { txHash } = req.params;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      const { ownerWallet, status } = tx;
      if (req.user.wallet !== ownerWallet) throw new ValidationError('NOT_OWNER', 403);
      if (status !== 'complete') throw new ValidationError('TX_NOT_COMPLETE', 409);
      const accessToken = await rotateArweaveTxAccessToken(txHash);
      res.json({ accessToken });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
