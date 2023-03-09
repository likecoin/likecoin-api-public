import { Router } from 'express';
import multer from 'multer';

import axios from 'axios';
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
import { API_EXTERNAL_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';
import {
  checkAndLockMintStatus,
  checkUserIsActiveNFTSubscriber,
  createNewMintTransaction,
  getAllMintTransaction,
  unlockMintStatus,
  updateAndUnlockMintStatus,
  verifyAuthorizationHeader,
} from '../../../util/api/likernft/subscription';
import { getLikerNFTSigningAddressInfo, getLikerNFTSigningClient, getNFTISCNData } from '../../../util/cosmos/nft';
import { processCreateISCN } from '../../../util/api/iscn';
import { createRoyaltyConfig, processMintNFTClass, processNewNFTClass } from '../../../util/api/likernft/subscription/mint';
import { checkCosmosSignPayload } from '../../../util/api/users';
import { filterNFTSubscriptionMintStatus } from '../../../util/ValidationHelper';

const router = Router();

router.post(
  '/mint/new',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const { signature, publicKey, message } = req.body;
      if (!checkCosmosSignPayload({
        signature, publicKey, message, inputWallet: wallet as string, action: 'new_mint',
      })) {
        throw new ValidationError('INVALID_SIGN', 401);
      }
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const isActiveUser = await checkUserIsActiveNFTSubscriber(wallet as string);
      if (!isActiveUser) throw new ValidationError('NOT_SUBSCRIBED');
      const { statusId, statusSecret } = await createNewMintTransaction(wallet as string);
      res.json({
        statusId,
        statusSecret,
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
  verifyAuthorizationHeader,
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1', wallet } = req.query;
      const { statusId } = req.params;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      await checkAndLockMintStatus(statusId, 'arweave');
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
      const payload: {[key: string]: string} = {
        transactionHash,
        arweaveId,
        ipfsHash,
      };
      if (totalLIKE) payload.totalLIKE = totalLIKE.toFixed();
      await updateAndUnlockMintStatus(statusId, 'arweave', payload);
      res.json({
        statusId,
        transactionHash,
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
  verifyAuthorizationHeader,
  async (req, res, next) => {
    try {
      const { statusId } = req.params;
      const { metadata } = req.body;
      const { wallet } = req.query;
      await checkAndLockMintStatus(statusId, 'iscn');
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
        totalLIKE,
        gasUsed,
        gasWanted,
      } = result;
      await updateAndUnlockMintStatus(statusId, 'iscn', {
        transactionHash,
        iscnId,
        totalLIKE: totalLIKE.toFixed(),
      }, { iscnId });
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
  verifyAuthorizationHeader,
  multer({ limits: { fileSize: ARWEAVE_MAX_SIZE } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1', wallet } = req.query;
      const { statusId } = req.params;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      if (files && files.length > 1) throw new ValidationError('TOO_MANY_FILES');
      const { iscnId } = await checkAndLockMintStatus(statusId, 'coverArweave');
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
      const payload: {[key: string]: string} = {
        transactionHash,
        arweaveId,
        ipfsHash,
      };
      if (totalLIKE) payload.totalLIKE = totalLIKE.toFixed();
      await updateAndUnlockMintStatus(statusId, 'coverArweave', payload);
      res.json({
        statusId,
        arweaveId,
        ipfsHash,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionNFTCoverArweaveUpload',
        statusId,
        iscnId,
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

router.post(
  '/mint/:statusId/nft/class',
  verifyAuthorizationHeader,
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const { statusId } = req.params;
      const {
        iscnId,
        name,
        description,
        image,
        externalURL,
        message,
        isCustomImage,
      } = req.body;
      const { iscnId: dbIscnId } = await checkAndLockMintStatus(statusId, 'nftClass');
      if (dbIscnId !== iscnId) throw new ValidationError('ISCN_ID_NOT_MATCH');
      const signingClient = await getLikerNFTSigningClient();
      const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
      const signingInfo = { address, accountNumber };
      const result = await processNewNFTClass(
        iscnId,
        {
          name,
          description,
          image,
          externalURL,
          message,
          isCustomImage,
        },
        signingClient,
        signingInfo,
      );
      const {
        transactionHash,
        classId,
        gasLIKE,
        totalLIKE,
        gasUsed,
        gasWanted,
      } = result;
      const iscnData = await getNFTISCNData(iscnId);
      const royaltyResult = await createRoyaltyConfig(
        iscnData.data,
        address,
        classId,
        signingClient,
        signingInfo,
      );
      const {
        transactionHash: royaltyTransactionHash,
        gasUsed: royaltyGasUsed,
        gasWanted: royaltyGasWanted,
      } = royaltyResult;
      await updateAndUnlockMintStatus(statusId, 'nftClass', {
        transactionHash,
        totalLIKE: totalLIKE.toFixed(),
        royaltyTransactionHash,
        classId,
      }, { classId });

      res.json({
        txHash: transactionHash,
        classId,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionNFTNewClass',
        statusId,
        wallet,
        iscnId,
        classId,
        gasLIKEString: gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE.toNumber(),
        totalLIKEString: totalLIKE.toFixed(),
        totalLIKENumber: totalLIKE.toNumber(),
        gasUsed,
        gasWanted,
        transactionHash,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionNFTNewRoyalty',
        statusId,
        wallet,
        iscnId,
        classId,
        gasUsed: royaltyGasUsed,
        gasWanted: royaltyGasWanted,
        transactionHash: royaltyTransactionHash,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/mint/:statusId/nft/mint',
  verifyAuthorizationHeader,
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const { statusId } = req.params;
      const {
        iscnId,
        classId,
        name,
        image,
        message,
      } = req.body;
      const amount = 500;
      const signingClient = await getLikerNFTSigningClient();
      const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
      const signingInfo = { address, accountNumber };
      const result = await processMintNFTClass(
        iscnId,
        classId,
        {
          name,
          image,
          message,
        },
        amount,
        wallet as string,
        signingClient,
        signingInfo,
      );
      const {
        nftsIds,
        transactionHash,
        totalLIKE,
        gasLIKE,
        gasWanted,
        gasUsed,
      } = result;
      await updateAndUnlockMintStatus(statusId, 'nftMint', {
        transactionHash,
        totalLIKE: totalLIKE.toFixed(),
      });
      res.json({
        txHash: transactionHash,
        classId,
        nftsIds,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTSubscriptionNFTMintNFT',
        statusId,
        wallet,
        iscnId,
        classId,
        mintAmount: amount,
        gasLIKEString: gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE.toNumber(),
        totalLIKEString: totalLIKE.toFixed(),
        totalLIKENumber: totalLIKE.toNumber(),
        gasUsed,
        gasWanted,
        transactionHash,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/mint/:statusId/done',
  verifyAuthorizationHeader,
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const { statusId } = req.params;
      const { classId, iscnId } = await checkAndLockMintStatus(statusId, 'done');
      try {
        // TODO: dont route via external
        await axios.post(
          `https://${API_EXTERNAL_HOSTNAME}/likernft/mint?iscn_id=${encodeURIComponent(iscnId)}&class_id=${encodeURIComponent(classId)}`,
        );
        await updateAndUnlockMintStatus(statusId, 'done');
        res.sendStatus(200);
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'NFTSubscriptionNFTDone',
          statusId,
          wallet,
          iscnId,
          classId,
        });
      } catch (err) {
        await unlockMintStatus(statusId);
        throw err;
      }
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
      res.json(filterNFTSubscriptionMintStatus(docData));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/mint/status/list',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const { signature, publicKey, message } = req.body;
      if (!checkCosmosSignPayload({
        signature, publicKey, message, inputWallet: wallet as string, action: 'list_mint',
      })) {
        throw new ValidationError('INVALID_SIGN', 401);
      }
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const list = await getAllMintTransaction(wallet as string);
      res.json({ list: list.map((s) => filterNFTSubscriptionMintStatus(s)) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
