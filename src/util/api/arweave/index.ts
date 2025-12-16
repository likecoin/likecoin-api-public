import axios from 'axios';
import BigNumber from 'bignumber.js';
import { formatEther } from 'viem';
import {
  estimateARV2Price,
} from '../../arweave';
import { ValidationError } from '../../ValidationError';
import { uploadFileToIPFS } from '../../ipfs';

import {
  ARWEAVE_EVM_TARGET_ADDRESS,
} from '../../../../config/config';
import { ARWEAVE_GATEWAY } from '../../../constant';
import { getEVMClient } from '../../evm/client';

export const ARWEAVE_MAX_SIZE_V2 = 200 * 1024 * 1024; // 200 MB

export async function estimateUploadToArweaveV2(
  fileSize: number,
  ipfsHash?: string,
  { margin = 0.05, checkDuplicate = true } = {},
) {
  if (fileSize > ARWEAVE_MAX_SIZE_V2) {
    throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
  }
  const {
    ETH, arweaveId,
  } = await estimateARV2Price(fileSize, ipfsHash, { checkDuplicate, margin });
  return {
    ETH, arweaveId, isExists: !!arweaveId,
  };
}

export async function checkArweaveTxV2({
  fileSize, ipfsHash, txHash, ETH, txToken,
}) {
  switch (txToken) {
    case 'BASEETH': {
      const client = getEVMClient();
      await client.waitForTransactionReceipt({ hash: txHash, timeout: 60000 });
      const tx = await client.getTransaction({ hash: txHash });
      if (!tx) {
        throw new ValidationError('TX_NOT_FOUND');
      }
      const { value, to, input } = tx;
      if (to?.toLowerCase() !== ARWEAVE_EVM_TARGET_ADDRESS.toLowerCase()) {
        throw new ValidationError('TX_TO_NOT_MATCH');
      }
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      if (!receipt) {
        throw new ValidationError('TX_RECEIPT_NOT_FOUND');
      }
      const { status } = receipt;
      if (status !== 'success') {
        throw new ValidationError('TX_FAILED');
      }
      const memo = Buffer.from(input.replace('0x', ''), 'hex').toString();
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
      const txAmount = new BigNumber(formatEther(value));
      if (txAmount.lt(ETH)) {
        throw new ValidationError('TX_AMOUNT_NOT_ENOUGH');
      }
      if (memoFileSize < fileSize) {
        throw new ValidationError('TX_MEMO_FILE_SIZE_NOT_ENOUGH');
      }
      if (fileSize > ARWEAVE_MAX_SIZE_V2) {
        throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
      }
      break;
    }
    default:
      throw new ValidationError('INVALID_TX_TOKEN');
  }
}

export async function pushArweaveSingleFileToIPFS({ arweaveId, ipfsHash, fileSize }) {
  const { data } = await axios.get(`${ARWEAVE_GATEWAY}/${arweaveId}`, { responseType: 'arraybuffer' });
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
