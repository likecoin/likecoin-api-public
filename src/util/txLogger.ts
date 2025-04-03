import { txCollection as dbRef } from './firebase';

export async function logCosmosTx(payload) {
  const { txHash } = payload;
  try {
    await dbRef.doc(txHash).create({
      type: 'cosmosTransfer',
      status: 'pending',
      ts: Date.now(),
      remarks: payload.memo,
      ...payload,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function logISCNTx(payload) {
  const { txHash } = payload;
  try {
    await dbRef.doc(txHash).create({
      type: 'cosmosISCNSignature',
      status: 'pending',
      ts: Date.now(),
      remarks: payload.memo,
      ...payload,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function logEVMMintNFTsTx(payload) {
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
