import BigNumber from 'bignumber.js';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { ISCNSigningClient } from '@likecoin/iscn-js';
import { estimateARPrices, convertARPricesToLIKE, uploadFilesToArweave } from '../../arweave';
import { ValidationError } from '../../ValidationError';
import { COSMOS_CHAIN_ID } from '../../cosmos';
import {
  queryLIKETransactionInfo,
  DEFAULT_TRANSFER_GAS,
  DEFAULT_GAS_PRICE,
  generateSendTxData,
  sendTransactionWithSequence,
} from '../../cosmos/tx';
import { getIPFSHash, uploadFilesToIPFS } from '../../ipfs';

import { ARWEAVE_LIKE_TARGET_ADDRESS } from '../../../../config/config';

export const ARWEAVE_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

export function checkFileValid(req, res, next) {
  if (!(req.files && req.files.length)) {
    res.status(400).send('MISSING_FILE');
    return;
  }
  const { files } = req;
  if (files.length > 1 && !files.find((f) => f.fieldname === 'index.html')) {
    res.status(400).send('MISSING_INDEX_FILE');
    return;
  }
  next();
}

export function convertMulterFiles(files) {
  return files.map((f) => {
    const { mimetype, buffer } = f;
    return {
      key: f.fieldname,
      mimetype,
      buffer,
    };
  });
}

export async function estimateUploadToArweave(
  arFiles,
  { checkDuplicate = true, addTxFee = false, margin = 0.05 } = {},
) {
  let isExists = false;
  const [
    ipfsHash,
    prices,
  ] = await Promise.all([
    getIPFSHash(arFiles),
    estimateARPrices(arFiles, checkDuplicate),
  ]);
  const {
    arweaveId: existingArweaveId,
  } = prices;

  if (existingArweaveId) {
    isExists = true;
    return {
      isExists,
      ipfsHash,
      LIKE: 0,
      ...prices,
    };
  }
  const { LIKE } = await convertARPricesToLIKE(prices, { margin });
  if (!LIKE) throw new ValidationError('CANNOT_FETCH_ARWEAVE_ID_NOR_PRICE', 500);
  let uploadPrice;
  if (addTxFee) {
    const txSignNeed = new BigNumber(DEFAULT_TRANSFER_GAS)
      .multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9).toNumber();
    uploadPrice = Number(LIKE) + txSignNeed;
  }
  return {
    isExists,
    ipfsHash,
    uploadPrice,
    LIKE,
    ...prices,
  };
}

export async function processSigningUploadToArweave(
  arFiles,
  signingClient: ISCNSigningClient,
  signingInfo: {
    address: string,
    accountNumber: number,
  },
  { checkDuplicate = true, margin = 0.03 } = {},
) {
  const estimate = await estimateUploadToArweave(
    arFiles,
    { addTxFee: true, checkDuplicate, margin },
  );
  const {
    LIKE,
    ipfsHash,
    arweaveId: existingArweaveId,
    list: existingPriceList,
    isExists,
    key,
    AR,
  } = estimate;

  if (isExists) {
    return {
      isExists,
      ipfsHash,
      key,
      arweaveId: existingArweaveId,
      AR,
      LIKE,
      list: existingPriceList,
      gasLIKE: null,
      totalLIKE: null,
      gasUsed: null,
      gasWanted: null,
      transactionHash: null,
    };
  }
  const amount = new BigNumber(LIKE).shiftedBy(9).toFixed();
  const {
    address,
    accountNumber,
  } = signingInfo;
  const { messages, fee } = generateSendTxData(address, ARWEAVE_LIKE_TARGET_ADDRESS, amount);
  const memo = JSON.stringify({ ipfs: ipfsHash });
  const client = signingClient.getSigningStargateClient();
  if (!client) throw new Error('CANNOT_GET_SIGNING_CLIENT');
  const transferTxSigningFunction = async ({ sequence }: { sequence: number }) => {
    const r = await client.sign(
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
    return r as TxRaw;
  };
  const arweaveIdList = existingPriceList ? existingPriceList.map(
    (l) => l.arweaveId,
  ) : undefined;
  const [{ arweaveId, list }, , txRes] = await Promise.all([
    uploadFilesToArweave(arFiles, arweaveIdList, checkDuplicate),
    uploadFilesToIPFS(arFiles),
    sendTransactionWithSequence(
      address,
      transferTxSigningFunction,
    ),
  ]);
  const { transactionHash, gasUsed, gasWanted } = txRes;
  const gasLIKE = new BigNumber(gasWanted).multipliedBy(DEFAULT_GAS_PRICE).shiftedBy(-9);
  const totalLIKE = gasLIKE.plus(LIKE);
  return {
    isExists,
    ipfsHash,
    key,
    arweaveId,
    AR,
    LIKE,
    list,
    gasLIKE,
    totalLIKE,
    gasUsed,
    gasWanted,
    transactionHash,
  };
}

export async function processTxUploadToArweave(
  arFiles,
  txHash,
  { checkDuplicate = true, margin = 0.03 } = {},
) {
  const estimate = await estimateUploadToArweave(arFiles, { checkDuplicate, margin });
  const {
    LIKE,
    ipfsHash,
    list: existingPriceList,
    isExists,
    key,
    AR,
  } = estimate;

  if (isExists) {
    return estimate;
  }

  const tx = await queryLIKETransactionInfo(txHash, ARWEAVE_LIKE_TARGET_ADDRESS);
  if (!tx || !tx.amount) {
    throw new ValidationError('TX_NOT_FOUND');
  }
  const { memo, amount } = tx;
  let memoIPFS = '';
  try {
    ({ ipfs: memoIPFS } = JSON.parse(memo));
  } catch (err) {
  // ignore non-JSON memo
  }
  if (!memoIPFS || memoIPFS !== ipfsHash) {
    throw new ValidationError('TX_MEMO_NOT_MATCH');
  }
  const txAmount = new BigNumber(amount.amount).shiftedBy(-9);
  if (txAmount.lt(LIKE)) {
    throw new ValidationError('TX_AMOUNT_NOT_ENOUGH');
  }
  const arweaveIdList = existingPriceList ? existingPriceList.map(
    (l) => l.arweaveId,
  ) : undefined;
  const [{ arweaveId, list }] = await Promise.all([
    uploadFilesToArweave(arFiles, arweaveIdList, checkDuplicate),
    uploadFilesToIPFS(arFiles),
  ]);
  return {
    isExists,
    ipfsHash,
    key,
    arweaveId,
    AR,
    LIKE,
    list,
  };
}

export default convertMulterFiles;
