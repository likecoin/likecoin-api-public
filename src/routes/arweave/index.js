import BigNumber from 'bignumber.js';
import { Router } from 'express';
import multer from 'multer';
import { estimateARPrice, convertARPriceToLIKE, uploadFileToArweave } from '../../util/arweave';
import { getIPFSHash } from '../../util/ipfs';
import { queryLIKETransactionInfo } from '../../util/cosmos/tx';

const { ARWEAVE_LIKE_TARGET_ADDRESS } = require('../../../config/config');

const router = Router();

router.post('/estimate', multer().single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.sendStatus(400);
      return;
    }
    const { AR, arweaveId } = await estimateARPrice(req.file);
    const LIKE = await convertARPriceToLIKE(AR);
    res.json({
      AR, LIKE, arweaveId, address: ARWEAVE_LIKE_TARGET_ADDRESS,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/upload', multer().single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).send('MISSING_FILE');
      return;
    }
    const ipfsHash = await getIPFSHash(req.file.buffer);
    const { AR, arweaveId: existingArweaveId } = await estimateARPrice(req.file);

    // shortcut for existing file without checking tx
    if (existingArweaveId) {
      res.json({ arweaveId: existingArweaveId, ipfsHash });
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
    const LIKE = await convertARPriceToLIKE(AR, { margin: 0.03 });
    const txAmount = new BigNumber(amount.amount).shiftedBy(-9);
    if (txAmount.lt(LIKE)) {
      res.status(400).send('TX_AMOUNT_NOT_ENOUGH');
      return;
    }
    const { arweaveId } = await uploadFileToArweave(req.file);
    res.json({ arweaveId, ipfsHash });
  } catch (error) {
    next(error);
  }
});

export default router;
