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
import { DEFAULT_GAS_PRICE } from '../../util/cosmos/tx';

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
      const [signingClient, queryClient] = await Promise.all([
        getISCNSigningClient(),
        getISCNQueryClient(),
      ]);
      const address = await getISCNSigningAddress();
      const [iscnFee, iscnRes] = await Promise.all([
        signingClient.estimateISCNTxFee(address, ISCNPayload),
        signingClient.createISCNRecord(address, ISCNPayload),
      ]);
      const iscnLike = new BigNumber(iscnFee).shiftedBy(-9);
      const {
        transactionHash: txHash,
        gasUsed,
      } = iscnRes;
      const gasLIKE = new BigNumber(gasUsed).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
      const totalLIKE = gasLIKE.plus(iscnLike);
      const iscnID = await queryClient.queryISCNIdsByTx(txHash);
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'ISCNFreeRegister',
        txHash,
        iscnID,
        iscnLIKEString: iscnLike.toFixed(),
        iscnLIKENumber: iscnLike.toNumber(),
        gasLIKEString: gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE.toNumber(),
        totalLIKEString: totalLIKE.toFixed(),
        totalLIKENumber: totalLIKE.toNumber(),
        gasUsed,
        fromProvider: (req.user || {}).azp || undefined,
      });
      res.json({
        txHash,
        iscnID,
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
