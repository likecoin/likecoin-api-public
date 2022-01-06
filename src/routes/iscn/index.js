import { Router } from 'express';
import multer from 'multer';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { jwtAuth } from '../../middleware/jwt';
import {
  getISCNSigningClient,
  getISCNQueryClient,
  getISCNSigningAddress,
} from '../../util/cosmos/iscn';

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
      const iscnRes = await signingClient.createISCNRecord(address, ISCNPayload);
      const txHash = iscnRes.transactionHash;
      const iscnID = await queryClient.queryISCNIdsByTx(txHash);
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'ISCNFreeRegister',
        txHash,
        iscnID,
      });
      res.json({
        txHash,
        iscnID,
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
