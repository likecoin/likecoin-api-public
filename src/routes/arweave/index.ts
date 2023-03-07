import { Router } from 'express';
import multer from 'multer';
import {
  ARWEAVE_MAX_SIZE,
  checkFileValid,
  convertMulterFiles,
  estimateUploadToArweave,
  processTxUploadToArweave,
} from '../../util/api/arweave';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { ARWEAVE_LIKE_TARGET_ADDRESS } from '../../../config/config';

const router = Router();

router.post(
  '/estimate',
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE } }).any(),
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
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE } }).any(),
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
