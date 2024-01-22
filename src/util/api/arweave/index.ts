import axios from 'axios';
import BigNumber from 'bignumber.js';
import { ISCNSigningClient } from '@likecoin/iscn-js';
import {
  estimateARPrices,
  convertARPricesToLIKE,
  estimateARV2MaticPrice,
  convertMATICPriceToLIKE,
  uploadFilesToArweave,
} from '../../arweave';
import { signData } from '../../arweave/signer';
import { ValidationError } from '../../ValidationError';
import {
  queryLIKETransactionInfo,
  DEFAULT_TRANSFER_GAS,
  DEFAULT_GAS_PRICE,
  generateSendTxData,
  getSigningFunction,
  sendTransactionWithSequence,
} from '../../cosmos/tx';
import { getIPFSHash, uploadFileToIPFS, uploadFilesToIPFS } from '../../ipfs';

import { ARWEAVE_LIKE_TARGET_ADDRESS } from '../../../../config/config';

export const ARWEAVE_MAX_SIZE_V1 = 100 * 1024 * 1024; // 100 MB
export const ARWEAVE_MAX_SIZE_V2 = 200 * 1024 * 1024; // 200 MB

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

export async function estimateUploadToArweaveV2(
  fileSize: number,
  ipfsHash: string,
  { margin = 0.05 } = {},
) {
  if (fileSize > ARWEAVE_MAX_SIZE_V2) {
    throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
  }
  const { MATIC, wei, arweaveId } = await estimateARV2MaticPrice(fileSize, ipfsHash);
  const { LIKE } = await convertMATICPriceToLIKE(MATIC, { margin });
  if (!LIKE) throw new ValidationError('CANNOT_FETCH_ARWEAVE_ID_NOR_PRICE', 500);
  return {
    LIKE, MATIC, wei, arweaveId, isExists: !!arweaveId,
  };
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
  const transferTxSigningFunction = getSigningFunction({
    signingStargateClient: client,
    address,
    messages,
    fee,
    memo,
    accountNumber,
  });
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

async function checkTxV2({
  fileSize, ipfsHash, txHash, LIKE,
}) {
  const tx = await queryLIKETransactionInfo(txHash, ARWEAVE_LIKE_TARGET_ADDRESS);
  if (!tx || !tx.amount) {
    throw new ValidationError('TX_NOT_FOUND');
  }
  const { memo, amount } = tx;
  let memoIPFS = '';
  let memoFileSize = 0;
  try {
    ({ ipfs: memoIPFS, fileSize: memoFileSize } = JSON.parse(memo));
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
  if (memoFileSize < fileSize) {
    throw new ValidationError('TX_MEMO_FILE_SIZE_NOT_ENOUGH');
  }
  if (fileSize > ARWEAVE_MAX_SIZE_V2) {
    throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
  }
}

export async function processTxUploadToArweaveV2({
  fileSize, ipfsHash, txHash, signatureData,
}, { margin = 0.03 } = {}) {
  const estimate = await estimateUploadToArweaveV2(fileSize, ipfsHash, { margin });
  const {
    LIKE,
    MATIC,
    wei,
    arweaveId,
    isExists,
  } = estimate;

  await checkTxV2({
    fileSize, ipfsHash, txHash, LIKE,
  });

  // TODO: verify signatureData match filesize if possible
  const signature = await signData(Buffer.from(signatureData, 'base64'));
  return {
    isExists,
    ipfsHash,
    arweaveId,
    MATIC,
    wei,
    LIKE,
    signature,
  };
}

async function pushArweaveSingleFileToIPFS({ arweaveId, ipfsHash, fileSize }) {
  const { data } = await axios.get(`https://arweave.net/${arweaveId}`, { responseType: 'arraybuffer' });
  const returnedSize = (data as ArrayBuffer).byteLength;
  if (returnedSize > fileSize) {
    throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
  }
  const uploadedIpfsId = await uploadFileToIPFS({ buffer: data });
  if (uploadedIpfsId !== ipfsHash) {
    // eslint-disable-next-line no-console
    console.warn(`IPFS hash mismatch: ${uploadedIpfsId} !== ${ipfsHash}, arweaveId: ${arweaveId}`);
  }
}

export async function processArweaveIdRegisterV2({
  fileSize, ipfsHash, txHash, arweaveId,
}, { margin = 0.03 } = {}) {
  const estimate = await estimateUploadToArweaveV2(fileSize, ipfsHash, { margin });
  const { LIKE } = estimate;

  await checkTxV2({
    fileSize, ipfsHash, txHash, LIKE,
  });

  await pushArweaveSingleFileToIPFS({ arweaveId, ipfsHash, fileSize });
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
