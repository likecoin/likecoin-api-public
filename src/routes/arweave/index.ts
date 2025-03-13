import { Router } from 'express';
import multer from 'multer';
import {
  ARWEAVE_MAX_SIZE_V1,
  checkFileValid,
  convertMulterFiles,
  estimateUploadToArweave,
  estimateUploadToArweaveV2,
  processArweaveIdRegisterV2,
  processTxUploadToArweave,
  processTxUploadToArweaveV2,
} from '../../util/api/arweave';
import publisher from '../../util/gcloudPub';
import { API_HOSTNAME, ARWEAVE_GATEWAY, PUBSUB_TOPIC_MISC } from '../../constant';
import { ARWEAVE_LIKE_TARGET_ADDRESS, ARWEAVE_LINK_INTERNAL_TOKEN } from '../../../config/config';
import { getPublicKey } from '../../util/arweave/signer';
import { createNewArweaveTx, getArweaveTxInfo, updateArweaveTxStatus } from '../../util/api/arweave/tx';
import { jwtOptionalAuth } from '../../middleware/jwt';
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
        LIKE,
        arweaveId,
        MATIC,
        wei,
      } = await estimateUploadToArweaveV2(fileSize, ipfsHash);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveEstimateV2',
        ipfsHash,
        arweaveId,
        MATIC,
        LIKE: Number(LIKE),
      });
      res.json({
        LIKE,
        arweaveId,
        MATIC,
        wei,
        memo: JSON.stringify({ ipfs: ipfsHash, fileSize }),
        address: ARWEAVE_LIKE_TARGET_ADDRESS,
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
        fileSize, ipfsHash, txHash, signatureData,
      } = req.body;
      if (!txHash) throw new Error('MISSING_TX_HASH');
      if (!ipfsHash) throw new Error('MISSING_IPFS_HASH');
      if (!fileSize) throw new Error('MISSING_FILE_SIZE');
      if (!signatureData) throw new Error('MISSING_SIGNATURE_DATA');
      const {
        arweaveId,
        MATIC,
        wei,
        LIKE,
        signature,
      } = await processTxUploadToArweaveV2({
        fileSize, ipfsHash, txHash, signatureData,
      });
      const signatureHex = signature && signature.toString('base64');
      const { token } = await createNewArweaveTx(txHash, {
        ipfsHash,
        fileSize,
        ownerWallet: req.user?.wallet || '',
      });
      res.json({
        token,
        id: txHash,
        arweaveId,
        signature: signatureHex,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveSigningV2',
        ipfsHash,
        arweaveId,
        MATIC,
        wei,
        LIKE: Number(LIKE),
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
      await updateArweaveTxStatus(txHash, {
        arweaveId,
        ownerWallet: req.user?.wallet || '',
        key,
        isRequireAuth,
      });
      res.json({
        link: `https://${API_HOSTNAME}/arweave/v2/link/${txHash}`,
        token,
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
      await processArweaveIdRegisterV2({
        fileSize, ipfsHash, txHash, arweaveId,
      });
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
      } = tx;
      if (isRequireAuth) {
        if (!req.user?.wallet && !token) throw new ValidationError('MISSING_USER', 401);
        const isUserAuthed = req.user?.wallet === ownerWallet;
        const isTokenAuthed = token === docToken
          || (ARWEAVE_LINK_INTERNAL_TOKEN && token === ARWEAVE_LINK_INTERNAL_TOKEN);
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
  '/estimate',
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE_V1 } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1' } = req.query;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      const arFiles = convertMulterFiles(files);
      const {
        ipfsHash,
        key,
        arweaveId,
        AR,
        LIKE,
        list,
      } = await estimateUploadToArweave(arFiles, { checkDuplicate });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveEstimate',
        ipfsHash,
        key,
        arweaveId,
        AR,
        LIKE: Number(LIKE),
        prices: list,
      });
      res.json({
        key,
        arweaveId,
        AR,
        LIKE,
        list,
        ipfsHash,
        memo: JSON.stringify({ ipfs: ipfsHash }),
        address: ARWEAVE_LIKE_TARGET_ADDRESS,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/upload',
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE_V1 } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1' } = req.query;
      const { txHash } = req.query;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      const arFiles = convertMulterFiles(files);

      const {
        isExists,
        ipfsHash,
        key,
        arweaveId,
        AR,
        LIKE,
        list,
      } = await processTxUploadToArweave(arFiles, txHash, { checkDuplicate });

      // shortcut for existing file without checking tx
      if (isExists) {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'arweaveAlreadyExists',
          arweaveId,
          ipfsHash,
        });
        res.json({
          arweaveId,
          ipfsHash,
        });
      } else {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'arweaveUpload',
          ipfsHash,
          key,
          arweaveId,
          AR,
          LIKE: Number(LIKE),
          files: list,
          txHash,
        });
        res.json({ arweaveId, ipfsHash, list });
      }
    } catch (error) {
      next(error);
    }
  },
);

export default router;
