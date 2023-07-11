import { Router } from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import BigNumber from 'bignumber.js';
import publisher from '../../util/gcloudPub';
import { IS_TESTNET, PUBSUB_TOPIC_MISC } from '../../constant';
import { jwtAuth } from '../../middleware/jwt';
import {
  getISCNSigningClient,
  getISCNSigningAddressInfo,
} from '../../util/cosmos/iscn';
import {
  DEFAULT_GAS_PRICE,
  DEFAULT_TRANSFER_GAS,
} from '../../util/cosmos/tx';
import { getUserWithCivicLikerProperties } from '../../util/api/users/getPublicInfo';
import {
  checkFileValid, convertMulterFiles, estimateUploadToArweave, processSigningUploadToArweave,
} from '../../util/api/arweave';
import { estimateCreateISCN, processCreateAndTransferISCN } from '../../util/api/iscn';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IS_CHAIN_UPGRADING } = require('../../../config/config');

const maxSize = 100 * 1024 * 1024; // 100 MB

const router = Router();

async function handleRegisterISCN(req, res, next) {
  try {
    const { user } = req.user;
    if (!user || (!IS_TESTNET && !req.user.azp)) {
      // TODO: remove oauth check when open to personal call
      res.status(403).send('OAUTH_NEEDED');
    }
    const { claim = 1, estimate } = req.query;
    const isClaim = claim && claim !== '0';
    let metadata = req.body.metadata || req.body || {};
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        res.status(400).send('INVALID_METADATA');
        return;
      }
    }
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
    if (!Array.isArray(contentFingerprints)) {
      res.status(400).send('FINGERPRINTS_SHOULD_BE_ARRAY');
      return;
    }
    if (!Array.isArray(stakeholders)) {
      res.status(400).send('STAKEHOLDERS_SHOULD_BE_ARRAY');
      return;
    }
    if (!Array.isArray(keywords)) {
      res.status(400).send('KEYWORDS_SHOULD_BE_ARRAY');
      return;
    }
    const [signingClient, userInfo] = await Promise.all([
      getISCNSigningClient(),
      getUserWithCivicLikerProperties(user),
    ]);
    if (!userInfo) {
      res.status(400).send('USER_NOT_FOUND');
      return;
    }
    const { likeWallet, cosmosWallet } = userInfo;
    const recordNotes = likeWallet || cosmosWallet || user;

    if (res.locals.arweaveId) contentFingerprints.push(`ar://${res.locals.arweaveId}`);
    if (res.locals.ipfsHash) contentFingerprints.push(`ipfs://${res.locals.ipfsHash}`);

    const ISCNPayload = {
      contentFingerprints,
      stakeholders,
      type,
      name,
      description,
      usageInfo,
      keywords,
      recordNotes,
      datePublished,
      url,
    };

    let { signingInfo } = res.locals;
    if (!signingInfo) {
      const { address, accountNumber } = await getISCNSigningAddressInfo();
      signingInfo = { address, accountNumber };
      res.locals.signingInfo = signingInfo;
    }

    if (estimate) {
      const LIKE = await estimateCreateISCN(ISCNPayload, signingClient);
      res.json({ LIKE });
      return;
    }

    if (IS_CHAIN_UPGRADING) {
      res.status(400).send('CHAIN_UPGRADING');
      return;
    }

    const wallet = isClaim ? (likeWallet || cosmosWallet) : null;

    const {
      iscnId,
      iscnLIKE,
      totalLIKE,
      gasLIKE,
      gasUsed,
      gasWanted,
      transactionHash: iscnTxHash,
    } = await processCreateAndTransferISCN(
      ISCNPayload,
      wallet,
      signingClient,
      signingInfo,
    );

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'ISCNFreeRegister',
      txHash: iscnTxHash,
      iscnId,
      iscnLIKEString: iscnLIKE.toFixed(),
      iscnLIKENumber: iscnLIKE.toNumber(),
      gasLIKEString: gasLIKE.toFixed(),
      gasLIKENumber: gasLIKE.toNumber(),
      totalLIKEString: totalLIKE.toFixed(),
      totalLIKENumber: totalLIKE.toNumber(),
      gasUsed,
      gasWanted,
      fromProvider: (req.user || {}).azp || undefined,
    });

    res.json({
      txHash: iscnTxHash,
      iscnId,
      arweaveId: res.locals.arweaveId,
      ipfsHash: res.locals.ipfsHash,
    });
  } catch (err) {
    next(err);
  }
}

router.post(
  '/new',
  jwtAuth('write:like'),
  handleRegisterISCN,
);

router.post(
  '/upload',
  jwtAuth('write:like'),
  bodyParser.urlencoded({ extended: false }),
  multer({ limits: { fileSize: maxSize } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { user } = req.user;
      if (!user || (!IS_TESTNET && !req.user.azp)) {
        // TODO: remove oauth check when open to personal call
        res.status(403).send('OAUTH_NEEDED');
      }
      if (IS_CHAIN_UPGRADING) {
        res.status(400).send('CHAIN_UPGRADING');
        return;
      }
      const { files } = req;
      const { deduplicate = '1', estimate } = req.query;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      const arFiles = convertMulterFiles(files);

      if (estimate) {
        // eslint-disable-next-line max-len
        const { LIKE } = await estimateUploadToArweave(arFiles, { addTxFee: true, checkDuplicate });
        const txSignNeed = new BigNumber(DEFAULT_TRANSFER_GAS)
          .multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9).toNumber();
        res.locals.uploadPrice = Number(LIKE) + txSignNeed;
        next();
        return;
      }

      const signingClient = await getISCNSigningClient();
      let { signingInfo } = res.locals;
      if (!signingInfo) {
        const { address, accountNumber } = await getISCNSigningAddressInfo();
        signingInfo = { address, accountNumber };
        res.locals.signingInfo = signingInfo;
      }
      const result = await processSigningUploadToArweave(
        arFiles,
        signingClient,
        signingInfo,
        { checkDuplicate },
      );

      const {
        isExists,
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

      if (isExists) {
        res.locals.arweaveId = arweaveId;
        res.locals.ipfsHash = ipfsHash;
        next();
        return;
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveFreeUpload',
        ipfsHash,
        key,
        arweaveId,
        AR,
        LIKE,
        files: list,
        gasLIKEString: gasLIKE.toFixed(),
        gasLIKENumber: gasLIKE.toNumber(),
        totalLIKEString: totalLIKE.toFixed(),
        totalLIKENumber: totalLIKE.toNumber(),
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
  handleRegisterISCN,
);

export default router;
