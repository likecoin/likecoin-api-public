import { txCollection as dbRef } from './firebase';
import type { TxData } from '../types/transaction';

export async function logEVMMintNFTsTx(payload: Partial<TxData> & {
  txHash: string;
  chainId: string;
  rawSignedTx: string;
  from: string;
  nonce: number;
  to: string;
}): Promise<void> {
  const {
    txHash,
    chainId,
    rawSignedTx,
    from,
    nonce,
    to,
    ...otherPayload
  } = payload;
  try {
    await dbRef.doc(txHash).create({
      type: 'evmMintNFTs',
      status: 'pending',
      ts: Date.now(),
      chainId,
      rawSignedTx,
      from,
      nonce,
      to,
      delegatorAddress: from,
      ...otherPayload,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export default logEVMMintNFTsTx;
