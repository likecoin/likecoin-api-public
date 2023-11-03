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
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { ARWEAVE_LIKE_TARGET_ADDRESS } from '../../../config/config';
import { getPublicKey } from '../../util/arweave/signer';

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
  async (req, res, next) => {
    try {
      const {
        fileSize, ipfsHash, txHash, signatureData,
      } = req.body;
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
      res.json({ arweaveId, signature: signatureHex });
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
  async (req, res, next) => {
    try {
      res.sendStatus(200);
      const {
        fileSize, ipfsHash, txHash, arweaveId,
      } = req.body;
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
