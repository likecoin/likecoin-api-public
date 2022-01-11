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
import { checkFileValid, convertMulterFiles } from '../../util/api/arweave';
import { estimateARPrices, convertARPricesToLIKE, uploadFilesToArweave } from '../../util/arweave';
import { getIPFSHash, uploadFilesToIPFS } from '../../util/ipfs';

const maxSize = 100 * 1024 * 1024; // 100 MB

const router = Router();

async function handleRegisterISCN(req, res, next) {
  try {
    const { user } = req.user;
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
      descrption,
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
    const { cosmosWallet } = userInfo;
    const recordNotes = cosmosWallet || user;
    const ISCNPayload = {
      contentFingerprints,
      stakeholders,
      type,
      name,
      descrption,
      usageInfo,
      keywords,
      recordNotes,
      datePublished,
      url,
    };
    if (!req.local.signingInfo) {
      const address = await getISCNSigningAddress();
      const { accountNumber } = await getAccountInfo(address);
      req.local.signingInfo = { address, accountNumber };
    }
    const {
      address,
      accountNumber,
    } = req.local.signingInfo;
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
    });

    if (isClaim && cosmosWallet) {
      const transferSigningFunction = ({ sequence }) => signingClient.changeISCNOwnership(
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
