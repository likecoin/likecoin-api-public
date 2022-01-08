import { Router } from 'express';
import multer from 'multer';
import BigNumber from 'bignumber.js';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { jwtAuth } from '../../middleware/jwt';
import {
  getISCNSigningClient,
  getISCNQueryClient,
  getISCNSigningAddress,
} from '../../util/cosmos/iscn';
import { DEFAULT_GAS_PRICE, sendTransactionWithSequence } from '../../util/cosmos/tx';
import { COSMOS_CHAIN_ID, getAccountInfo } from '../../util/cosmos';
import { getUserWithCivicLikerProperties } from '../../util/api/users/getPublicInfo';

const maxSize = 100 * 1024 * 1024; // 100 MB

const router = Router();

function checkFileValid(req, res, next) {
  if (!(req.files && req.files.length)) {
    res.status(400).send('MISSING_FILE');
    return;
  }
  const { files } = req;
  if (files.length > 1 && !files.find(f => f.fieldname === 'index.html')) {
    res.status(400).send('MISSING_INDEX_FILE');
    return;
  }
  next();
}

// function convertMulterFiles(files) {
//   return files.map((f) => {
//     const { mimetype, buffer } = f;
//     return {
//       key: f.fieldname,
//       mimetype,
//       buffer,
//     };
//   });
// }

router.post(
  '/new',
  jwtAuth('write:iscn'),
  async (req, res, next) => {
    try {
      const { user } = req.user;
      const { claim } = req.query;
      const isClaim = claim && claim !== '0';
      const {
        contentFingerprints,
        stakeholders,
        type,
        name,
        descrption,
        usageInfo,
        keywords,
      } = req.body;
      const ISCNPayload = {
        contentFingerprints,
        stakeholders,
        type,
        name,
        descrption,
        usageInfo,
        keywords,
      };
      const [signingClient, queryClient, userInfo] = await Promise.all([
        getISCNSigningClient(),
        getISCNQueryClient(),
        getUserWithCivicLikerProperties(user),
      ]);
      if (!userInfo) {
        res.status(400).send('USER_NOT_FOUND');
        return;
      }
      const address = await getISCNSigningAddress();
      const { accountNumber } = await getAccountInfo(address);
      const createIscnSigningFunction = ({ sequence }) => signingClient.createISCNRecord(
        address,
        ISCNPayload, {
          accountNumber,
          sequence,
          chainId: COSMOS_CHAIN_ID,
          broadcast: false,
        },
      );
      const [iscnFee, iscnRes] = await Promise.all([
        signingClient.estimateISCNTxFee(address, ISCNPayload),
        sendTransactionWithSequence(address, createIscnSigningFunction),
      ]);
      const iscnLike = new BigNumber(iscnFee).shiftedBy(-9);
      const {
        transactionHash: iscnTxHash,
        gasUsed,
      } = iscnRes;
      const txHashes = [iscnTxHash];
      const gasLIKE = new BigNumber(gasUsed).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
      let totalLIKE = gasLIKE.plus(iscnLike);
      const iscnId = await queryClient.queryISCNIdsByTx(iscnTxHash);
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'ISCNFreeRegister',
        txHash: iscnTxHash,
        iscnId,
        iscnLIKEString: iscnLike.toFixed(),
        iscnLIKENumber: iscnLike.toNumber(),
        gasLIKEString: gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE.toNumber(),
        totalLIKEString: totalLIKE.toFixed(),
        totalLIKENumber: totalLIKE.toNumber(),
        gasUsed,
        fromProvider: (req.user || {}).azp || undefined,
      });
      if (isClaim) {
        const { cosmosWallet } = userInfo;
        if (cosmosWallet) {
          const transferIscnSigningFunction = ({ sequence }) => signingClient.changeISCNOwnership(
            address,
            cosmosWallet,
            iscnId,
            {
              accountNumber,
              sequence,
              chainId: COSMOS_CHAIN_ID,
              broadcast: false,
            },
          );
          const iscnTransferRes = await sendTransactionWithSequence(
            address,
            transferIscnSigningFunction,
          );
          const {
            transactionHash: iscnTransferTxHash,
            gasUsed: transferGasUsed,
          } = iscnTransferRes;
          txHashes.push(iscnTransferTxHash);
          const transferGasLIKE = new BigNumber(transferGasUsed)
            .multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
          totalLIKE = totalLIKE.plus(transferGasLIKE);
          publisher.publish(PUBSUB_TOPIC_MISC, req, {
            logType: 'ISCNFreeRegisterTransfer',
            txHash: iscnTransferTxHash,
            iscnId,
            totalLIKEString: totalLIKE.toFixed(),
            totalLIKENumber: totalLIKE.toNumber(),
            gasLIKEString: transferGasLIKE.toFixed(),
            gasLIKENumber: transferGasLIKE.toNumber(),
            gasUsed: transferGasUsed,
            fromProvider: (req.user || {}).azp || undefined,
          });
        }
      }
      res.json({
        txHashes,
        iscnId,
        totalLIKEString: totalLIKE.toFixed(),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post('/upload',
  multer({ limits: { fileSize: maxSize } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      // publisher.publish(PUBSUB_TOPIC_MISC, req, {
      //   logType: 'ISCNFreeUpload',
      //   ipfsHash,
      //   key,
      //   arweaveId,
      //   AR,
      //   LIKE,
      //   files: list,
      //   txHash,
      // });
      // res.json({ arweaveId, ipfsHash, list });
    } catch (error) {
      next(error);
    }
  });

export default router;