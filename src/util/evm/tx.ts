import {
  type WriteContractParameters,
  type WalletClient,
  encodeFunctionData,
  SimulateContractParameters,
} from 'viem';
import { admin, db, txCollection as txLogRef } from '../firebase';
import { getEVMClient } from './client';
import publisher from '../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

// Reserved-but-unconfirmed nonces at or above this signal a stuck counter the
// tip-rollback can't self-heal. Base history: legit in-flight ~6-11 vs 100+ in
// the incident; 10 may fire on the busiest bursts but catches runaway early.
const NONCE_DRIFT_ALERT_THRESHOLD = 10;

export async function sendWriteContractWithNonce(
  walletClient: WalletClient,
  params: WriteContractParameters,
) {
  const publicClient = getEVMClient();
  let res;
  if (!walletClient.account) {
    throw new Error('Wallet client does not have account');
  }
  const { address } = walletClient.account;
  const [transactionCount] = await Promise.all([
    publicClient.getTransactionCount({
      address,
    }),
    await publicClient.simulateContract(params as SimulateContractParameters),
  ]);
  const counterRef = txLogRef.doc(`!counter_${address}`);
  const pendingNonce = await db.runTransaction(async (t: admin.firestore.Transaction) => {
    const d = await t.get(counterRef);
    const stored = d.data()?.value as number | undefined;
    // The on-chain confirmed nonce is the floor; the counter tracks reservations ahead of it.
    // Using max lets the chain reclaim the counter if it falls behind (e.g. reset after a halt).
    // This prevents the counter from drifting away from chain permanently.
    const next = Math.max(transactionCount, stored ?? transactionCount);
    t.set(counterRef, { value: next + 1 } as any, { merge: true });
    return next;
  });

  const drift = pendingNonce - transactionCount;
  if (drift >= NONCE_DRIFT_ALERT_THRESHOLD) {
    // eslint-disable-next-line no-console
    console.error('EVM_NONCE_DRIFT', JSON.stringify({
      address,
      confirmed: transactionCount,
      reserved: pendingNonce,
      drift,
    }));
  }

  let didBroadcast = false;
  try {
    const {
      address: toAddress,
      abi,
      functionName,
      args,
      account,
      ...otherParams
    } = params;
    if (!account) {
      throw new Error('Account is not provided');
    }
    const request = await walletClient.prepareTransactionRequest({
      ...otherParams,
      account: walletClient.account,
      to: toAddress,
      nonce: pendingNonce,
      data: encodeFunctionData({
        abi,
        functionName,
        args,
      }),
    });
    const serializedTransaction = await walletClient
      .signTransaction({
        ...request,
        account: walletClient.account,
      });
    const hash = await walletClient.sendRawTransaction({ serializedTransaction });
    // The tx is now on the wire, so the reserved nonce is consumed even if we
    // never see a receipt below. Never roll it back from here on.
    didBroadcast = true;
    await db.runTransaction((t: admin.firestore.Transaction) => t.get(counterRef).then((d) => {
      const data = d.data();
      if (data && pendingNonce + 1 > (data.value as number)) {
        t.update(counterRef, {
          value: pendingNonce + 1,
        });
      }
    }));
    if (!hash) {
      throw new Error('Transaction hash is not returned');
    }
    res = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 2, // 1 extra confirmation to be safe
    });
    return {
      result: res,
      tx: serializedTransaction,
      transactionHash: res.transactionHash,
      address,
      nonce: pendingNonce,
    };
  } catch (err) {
    // Roll back the reserved nonce on a pre-broadcast failure so it isn't left a
    // permanent gap; skip once broadcast since the nonce is consumed (reuse clashes
    // with the pending tx). Tip check avoids erasing a gap a concurrent send moved past.
    if (!didBroadcast) {
      await db.runTransaction((t: admin.firestore.Transaction) => t.get(counterRef)
        .then((d) => {
          const data = d.data();
          if (data && (data.value as number) === pendingNonce + 1) {
            t.update(counterRef, { value: pendingNonce });
          }
        }))
        // Best-effort: never let a rollback failure mask the original send error.
        // eslint-disable-next-line no-console
        .catch((rollbackErr) => console.error('Failed to roll back nonce', rollbackErr));
    }
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventCosmosError',
      fromWallet: address,
      txHash: (res || {}).transactionHash,
      txSequence: pendingNonce,
      error: (err as string).toString(),
    });
    // eslint-disable-next-line no-console
    console.error(err);
    throw err;
  }
}

export default sendWriteContractWithNonce;
