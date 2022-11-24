import BigNumber from 'bignumber.js';
import { Router } from 'express';
import multer from 'multer';
import { estimateARPrices, convertARPricesToLIKE, uploadFilesToArweave } from '../../util/arweave';
import { getIPFSHash, uploadFilesToIPFS } from '../../util/ipfs';
import { checkFileValid, convertMulterFiles } from '../../util/api/arweave';
import { queryLIKETransactionInfo } from '../../util/cosmos/tx';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ARWEAVE_LIKE_TARGET_ADDRESS } = require('../../../config/config');

const maxSize = 100 * 1024 * 1024; // 100 MB

const router = Router();

router.post(
  '/estimate',
  multer({ limits: { fileSize: maxSize } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1' } = req.query;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
      const arFiles = convertMulterFiles(files);
      const [
        ipfsHash,
        prices,
      ] = await Promise.all([
        getIPFSHash(arFiles),
        estimateARPrices(arFiles, checkDuplicate),
      ]);
      const pricesWithLIKE = await convertARPricesToLIKE(prices);
      const {
        key,
        arweaveId,
        AR,
        LIKE,
        list,
      } = pricesWithLIKE;
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
        ...pricesWithLIKE,
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
  multer({ limits: { fileSize: maxSize } }).any(),
  checkFileValid,
  async (req, res, next) => {
    try {
      const { files } = req;
      const { deduplicate = '1' } = req.query;
      const checkDuplicate = !!deduplicate && deduplicate !== '0';
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
        list: existingPriceListWithManifest,
      } = prices;

      // shortcut for existing file without checking tx
      if (existingArweaveId) {
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'arweaveAlreadyExists',
          arweaveId: existingArweaveId,
          ipfsHash,
        });
        res.json({
          arweaveId: existingArweaveId,
          ipfsHash,
        });
        return;
      }

      const { txHash } = req.query;
      if (!txHash) {
        res.status(400).send('MISSING_TX_HASH');
        return;
      }
      const tx = await queryLIKETransactionInfo(txHash, ARWEAVE_LIKE_TARGET_ADDRESS);
      if (!tx || !tx.amount) {
        res.status(400).send('TX_NOT_FOUND');
        return;
      }
      const { memo, amount } = tx;
      let memoIPFS = '';
      try {
        ({ ipfs: memoIPFS } = JSON.parse(memo));
      } catch (err) {
      // ignore non-JSON memo
      }
      if (!memoIPFS || memoIPFS !== ipfsHash) {
        res.status(400).send('TX_MEMO_NOT_MATCH');
        return;
      }
      const { LIKE } = await convertARPricesToLIKE(prices, { margin: 0.03 });
      const txAmount = new BigNumber(amount.amount).shiftedBy(-9);
      if (txAmount.lt(LIKE)) {
        res.status(400).send('TX_AMOUNT_NOT_ENOUGH');
        return;
      }
      let arweaveIdList;
      if (existingPriceListWithManifest) {
        const [, ...existingFilesPriceList] = existingPriceListWithManifest;
        arweaveIdList = existingFilesPriceList.map((l) => l.arweaveId);
      }
      const [{ arweaveId, list }] = await Promise.all([
        uploadFilesToArweave(arFiles, arweaveIdList, checkDuplicate),
        uploadFilesToIPFS(arFiles),
      ]);
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
    } catch (error) {
      next(error);
    }
  },
);

export default router;
