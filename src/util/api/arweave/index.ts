import axios from 'axios';
import type { Readable } from 'stream';
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
      const txAmount = new BigNumber(formatEther(value));
      if (txAmount.lt(ETH)) {
        throw new ValidationError('TX_AMOUNT_NOT_ENOUGH');
      }
      const memo = Buffer.from(input.replace('0x', ''), 'hex').toString();
      let memoIPFS = '';
      let memoFileSize = 0;
      try {
        ({ ipfs: memoIPFS, fileSize: memoFileSize } = JSON.parse(memo));
      } catch (err) {
        // ignore non-JSON memo
      }
      if (memoIPFS) {
        if (memoIPFS !== ipfsHash) {
          throw new ValidationError('TX_MEMO_NOT_MATCH');
        }
        if (memoFileSize < fileSize) {
          throw new ValidationError('TX_MEMO_FILE_SIZE_NOT_ENOUGH');
        }
      }
      if (fileSize > ARWEAVE_MAX_SIZE_V2) {
        throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
      }
      // The verified on-chain payment, forwarded into Irys as pass-through funding.
      return { paidETH: formatEther(value) };
    }
    default:
      throw new ValidationError('INVALID_TX_TOKEN');
  }
}

// `getStream` (or `buffer`) lets a caller that already has the bytes skip the
// gateway fetch entirely. The server-side upload path passes a factory: it holds
// the file in GCS, and a freshly uploaded id is exactly what a gateway has not
// seeded yet. The size guard applies only to gateway/buffer content — a caller
// supplying its own source has already verified it.
export async function pushArweaveSingleFileToIPFS({
  arweaveId, ipfsHash, fileSize, buffer, getStream,
}: {
  arweaveId?: string;
  ipfsHash?: string;
  fileSize?: number;
  buffer?: Buffer;
  getStream?: () => Readable;
}) {
  let source: { getStream: () => Readable } | { buffer: Buffer | ArrayBuffer };
  if (getStream) {
    source = { getStream };
  } else {
    let data: Buffer | ArrayBuffer | undefined = buffer;
    if (!data) {
      ({ data } = await axios.get(`${ARWEAVE_GATEWAY}/${arweaveId}`, { responseType: 'arraybuffer' }));
    }
    const returnedSize = Buffer.isBuffer(data)
      ? data.byteLength
      : (data as ArrayBuffer).byteLength;
    if (fileSize && returnedSize > fileSize) {
      throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
    }
    source = { buffer: data as Buffer };
  }
  const uploadedIpfsId = await uploadFileToIPFS(source);
  if (uploadedIpfsId !== ipfsHash) {
    // eslint-disable-next-line no-console
    console.warn(`IPFS hash mismatch: ${uploadedIpfsId} !== ${ipfsHash}, arweaveId: ${arweaveId}`);
  }
}
