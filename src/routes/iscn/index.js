import { Router } from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import BigNumber from 'bignumber.js';
import publisher from '../../util/gcloudPub';
import { IS_TESTNET, PUBSUB_TOPIC_MISC } from '../../constant';
import { jwtAuth } from '../../middleware/jwt';
import {
  getISCNSigningClient,
  getISCNQueryClient,
  getISCNSigningAddressInfo,
} from '../../util/cosmos/iscn';
import { DEFAULT_GAS_PRICE, sendTransactionWithSequence, generateSendTxData } from '../../util/cosmos/tx';
import { COSMOS_CHAIN_ID } from '../../util/cosmos';
import { getUserWithCivicLikerProperties } from '../../util/api/users/getPublicInfo';
import { checkFileValid, convertMulterFiles } from '../../util/api/arweave';
import { estimateARPrices, convertARPricesToLIKE, uploadFilesToArweave } from '../../util/arweave';
import { getIPFSHash, uploadFilesToIPFS } from '../../util/ipfs';

const { ARWEAVE_LIKE_TARGET_ADDRESS } = require('../../../config/config');

const maxSize = 100 * 1024 * 1024; // 100 MB

const router = Router();

async function handleRegisterISCN(req, res, next) {
  try {
    const { user } = req.user;
    if (!user || (!IS_TESTNET && !user.azp)) {
      // TODO: remove oauth check when open to personal call
      res.status(403).send('OAUTH_NEEDED');
    }
    const { claim = 1 } = req.query;
    const isClaim = claim && claim !== '0';
    let {
      metadata = {},
    } = req.body;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (err) {
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
    const [signingClient, queryClient, userInfo] = await Promise.all([
      getISCNSigningClient(),
      getISCNQueryClient(),
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
    if (!res.locals.signingInfo) {
      const { address, accountNumber } = await getISCNSigningAddressInfo();
      res.locals.signingInfo = { address, accountNumber: accountNumber.toNumber() };
    }
    const {
      address,
      accountNumber,
    } = res.locals.signingInfo;
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
    const iscnLike = new BigNumber(iscnFee.amount).shiftedBy(-9);
    const {
      transactionHash: iscnTxHash,
      gasWanted = 0,
      gasUsed = 0,
    } = iscnRes;
    const gasLIKE = new BigNumber(gasWanted).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
    let totalLIKE = gasLIKE.plus(iscnLike);
    const [iscnId] = await queryClient.queryISCNIdsByTx(iscnTxHash);
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
      gasWanted,
      fromProvider: (req.user || {}).azp || undefined,
    });

    // return early
    res.json({
      txHash: iscnTxHash,
      iscnId,
      arweaveId: res.locals.arweaveId,
      ipfsHash: res.locals.ipfsHash,
    });

    const wallet = likeWallet || cosmosWallet;
    if (isClaim && wallet) {
      const transferSigningFunction = ({ sequence }) => signingClient.changeISCNOwnership(
        address,
        wallet,
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
        transferSigningFunction,
      );
      const {
        transactionHash: iscnTransferTxHash,
        gasUsed: transferGasUsed,
      } = iscnTransferRes;
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
  } catch (err) {
    next(err);
  }
}

router.post(
  '/new',
  jwtAuth('write:iscn'),
  handleRegisterISCN,
);

router.post('/upload',
  jwtAuth('write:iscn'),
  bodyParser.urlencoded({ extended: false }),
  multer({ limits: { fileSize: maxSize } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { user } = req.user;
      if (!user || (!IS_TESTNET && !user.azp)) {
        // TODO: remove oauth check when open to personal call
        res.status(403).send('OAUTH_NEEDED');
      }
      const { files } = req;
      const { deduplicate = '1' } = req.query;
      const checkDuplicate = deduplicate && deduplicate !== '0';
      const arFiles = convertMulterFiles(files);
      const [
        ipfsHash,
        prices,
      ] = await Promise.all([
        getIPFSHash(arFiles),
        estimateARPrices(arFiles, checkDuplicate),
      ]);
      const {
        key,
        arweaveId: existingArweaveId,
        AR,
        list: existingPriceList,
      } = prices;

      if (existingArweaveId) {
        res.locals.arweaveId = existingArweaveId;
        res.locals.ipfsHash = ipfsHash;
        next();
        return;
      }
      const { LIKE } = await convertARPricesToLIKE(prices, { margin: 0.05 });
      if (!LIKE) {
        res.status(500).send('CANNOT_FETCH_ARWEAVE_ID_NOR_PRICE');
        return;
      }
      const amount = new BigNumber(LIKE).shiftedBy(9).toFixed();
      const signingClient = await getISCNSigningClient();
      if (!res.locals.signingInfo) {
        const { address, accountNumber } = await getISCNSigningAddressInfo();
        res.locals.signingInfo = { address, accountNumber: accountNumber.toNumber() };
      }
      const {
        address,
        accountNumber,
      } = res.locals.signingInfo;
      const { messages, fee } = generateSendTxData(address, ARWEAVE_LIKE_TARGET_ADDRESS, amount);
      const memo = JSON.stringify({ ipfs: ipfsHash });
      const client = signingClient.getSigningStargateClient();
      const transferTxSigningFunction = ({ sequence }) => client.sign(
        address,
        messages,
        fee,
        memo,
        {
          accountNumber,
          sequence,
          chainId: COSMOS_CHAIN_ID,
        },
      );
      const arweaveIdList = existingPriceList ? existingPriceList.map(l => l.arweaveId) : undefined;
      const [txRes, { arweaveId, list }] = await Promise.all([
        sendTransactionWithSequence(
          address,
          transferTxSigningFunction,
        ),
        uploadFilesToArweave(arFiles, arweaveIdList, checkDuplicate),
        uploadFilesToIPFS(arFiles),
      ]);
      const { transactionHash, gasUsed, gasWanted } = txRes;
      const gasLIKE = new BigNumber(gasWanted).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
      const totalLIKE = gasLIKE.plus(LIKE);
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
  handleRegisterISCN);

export default router;
