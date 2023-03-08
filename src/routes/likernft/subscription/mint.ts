import { Router } from 'express';
import multer from 'multer';

import { isValidLikeAddress } from '../../../util/cosmos';
import {
  likeNFTSubscriptionTxCollection,
} from '../../../util/firebase';
import {
  ARWEAVE_MAX_SIZE,
  checkFileValid,
  convertMulterFiles,
  processSigningUploadToArweave,
} from '../../../util/api/arweave';
import { ValidationError } from '../../../util/ValidationError';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';
import { checkUserIsActiveNFTSubscriber, createNewMintTransaction, getAllMintTransaction } from '../../../util/api/likernft/subscription';
import { getLikerNFTSigningAddressInfo, getLikerNFTSigningClient } from '../../../util/cosmos/nft';
import { processCreateISCN } from '../../../util/api/iscn';

const router = Router();

router.post(
  '/mint/new',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const isActiveUser = await checkUserIsActiveNFTSubscriber(wallet as string);
      if (!isActiveUser) throw new ValidationError('NOT_SUBSCRIBED');
      const statusId = await createNewMintTransaction(wallet as string);
      res.json({
        statusId,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionNewMint',
        statusId,
        wallet,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/mint/:statusId/arweave',
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1', wallet } = req.query;
      const { statusId } = req.params;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      const arFiles = convertMulterFiles(files);
      const signingClient = await getLikerNFTSigningClient();
      const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
      const signingInfo = { address, accountNumber };
      const result = await processSigningUploadToArweave(
        arFiles,
        signingClient,
        signingInfo,
        { checkDuplicate },
      );
      const {
        key,
        arweaveId,
        ipfsHash,
        AR,
        LIKE,
        list,
        gasLIKE,
        totalLIKE,
        gasUsed,
        gasWanted,
        transactionHash,
      } = result;
      res.json({
        statusId,
        arweaveId,
        ipfsHash,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionISCNArweaveUpload',
        statusId,
        wallet,
        ipfsHash,
        key,
        arweaveId,
        AR,
        LIKE,
        files: list,
        gasLIKEString: gasLIKE && gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE && gasLIKE.toNumber(),
        totalLIKEString: totalLIKE && totalLIKE.toFixed(),
        totalLIKENumber: totalLIKE && totalLIKE.toNumber(),
        gasUsed,
        gasWanted,
        txHash: transactionHash,
        fromProvider: (req.user || {}).azp || undefined,
      });
      next();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/mint/:statusId/iscn',
  async (req, res, next) => {
    try {
      const { statusId } = req.params;
      const { metadata } = req.body;
      const { wallet } = req.query;
      const {
        contentFingerprints = [],
        stakeholders = [],
        type,
        name,
        description,
        usageInfo,
        keywords = [],
        datePublished,
        url,
      } = metadata;

      const ISCNPayload = {
        contentFingerprints,
        stakeholders,
        type,
        name,
        description,
        usageInfo,
        keywords,
        recordNotes: wallet as string,
        datePublished,
        url,
      };
      const signingClient = await getLikerNFTSigningClient();
      const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
      const signingInfo = { address, accountNumber };
      const result = await processCreateISCN(ISCNPayload, signingClient, signingInfo);
      const {
        transactionHash,
        iscnId,
        iscnLIKE,
        gasLIKE,
        gasUsed,
        gasWanted,
      } = result;
      res.json({
        txHash: transactionHash,
        iscnId,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionCreateISCN',
        wallet,
        statusId,
        txHash: transactionHash,
        iscnId,
        iscnLIKEString: iscnLIKE.toFixed(),
        iscnLIKENumber: iscnLIKE.toNumber(),
        gasLIKEString: gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE.toNumber(),
        gasUsed,
        gasWanted,
      });
      next();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/mint/:statusId/nft/cover',
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1', wallet } = req.query;
      const { statusId } = req.params;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      if (files && files.length > 1) throw new ValidationError('TOO_MANY_FILES');
      const arFiles = convertMulterFiles(files);
      const signingClient = await getLikerNFTSigningClient();
      const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
      const signingInfo = { address, accountNumber };
      const result = await processSigningUploadToArweave(
        arFiles,
        signingClient,
        signingInfo,
        { checkDuplicate },
      );
      const {
        key,
        arweaveId,
        ipfsHash,
        AR,
        LIKE,
        list,
        gasLIKE,
        totalLIKE,
        gasUsed,
        gasWanted,
        transactionHash,
      } = result;
      res.json({
        statusId,
        arweaveId,
        ipfsHash,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionNFTCoverArweaveUpload',
        statusId,
        wallet,
        ipfsHash,
        key,
        arweaveId,
        AR,
        LIKE,
        files: list,
        gasLIKEString: gasLIKE && gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE && gasLIKE.toNumber(),
        totalLIKEString: totalLIKE && totalLIKE.toFixed(),
        totalLIKENumber: totalLIKE && totalLIKE.toNumber(),
        gasUsed,
        gasWanted,
        txHash: transactionHash,
      });
      next();
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/mint/:statusId/status',
  async (req, res, next) => {
    try {
      const { statusId } = req.params;
      const doc = await likeNFTSubscriptionTxCollection.doc(statusId).get();
      const docData = doc.data();
      if (!docData) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      res.json(docData);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/mint/status/list',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const list = await getAllMintTransaction(wallet as string);
      res.json({ list });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
