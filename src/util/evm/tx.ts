import {
  type Chain,
  type HttpTransport,
  type LocalAccount,
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

function getNonceCounterRef(address: string) {
  return txLogRef.doc(`!counter_${address}`);
}

// Every pod signing for the same wallet reserves here, so concurrent senders can't
// be handed the same nonce by a plain eth_getTransactionCount read.
async function reserveNonce(address: string, transactionCount: number): Promise<number> {
  const counterRef = getNonceCounterRef(address);
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
  return pendingNonce;
}

// Advance the counter tip past a consumed nonce, unless a concurrent reservation
// already moved further. Best-effort: the tx is on the wire by the time this runs, so
// a failure here must not surface as a send failure — the confirmed-nonce floor in
// reserveNonce reclaims the counter anyway.
async function commitNonce(address: string, nonce: number): Promise<void> {
  const counterRef = getNonceCounterRef(address);
  await db.runTransaction((t: admin.firestore.Transaction) => t.get(counterRef).then((d) => {
    const data = d.data();
    if (data && nonce + 1 > (data.value as number)) {
      t.update(counterRef, {
        value: nonce + 1,
      });
    }
  }))
    // eslint-disable-next-line no-console
    .catch((err) => console.error('Failed to commit nonce', err));
}

// Roll back a reservation whose tx never broadcast so it isn't left a permanent gap.
// Tip check avoids erasing a gap a concurrent send moved past.
async function rollbackNonce(address: string, nonce: number): Promise<void> {
  const counterRef = getNonceCounterRef(address);
  await db.runTransaction((t: admin.firestore.Transaction) => t.get(counterRef)
    .then((d) => {
      const data = d.data();
      if (data && (data.value as number) === nonce + 1) {
        t.update(counterRef, { value: nonce });
      }
    }))
    // Best-effort: never let a rollback failure mask the original send error.
    // eslint-disable-next-line no-console
    .catch((rollbackErr) => console.error('Failed to roll back nonce', rollbackErr));
}

// Sign and broadcast `request` on an already-reserved `nonce`, then settle the counter.
// Callers reserve rather than this helper so they keep the nonce for their own logging.
async function broadcastOnReservedNonce(
  walletClient: WalletClient,
  request: Record<string, any>,
  nonce: number,
): Promise<{ hash: `0x${string}`; serializedTransaction: `0x${string}` }> {
  const { account } = walletClient;
  if (!account) {
    throw new Error('Wallet client does not have account');
  }
  let didBroadcast = false;
  try {
    const prepared = await walletClient.prepareTransactionRequest(
      { ...request, account, nonce } as any,
    );
    const serializedTransaction = await walletClient
      .signTransaction({ ...prepared, account } as any);
    const hash = await walletClient.sendRawTransaction({ serializedTransaction });
    // The tx is now on the wire, so the reserved nonce is consumed even if anything
    // below fails. Never roll it back from here on.
    didBroadcast = true;
    await commitNonce(account.address, nonce);
    if (!hash) {
      throw new Error('Transaction hash is not returned');
    }
    return { hash, serializedTransaction };
  } catch (err) {
    // Roll back the reservation on a pre-broadcast failure so it isn't left a permanent
    // gap; once broadcast the nonce is consumed (reuse clashes with the pending tx).
    if (!didBroadcast) await rollbackNonce(account.address, nonce);
    throw err;
  }
}

// Plain value transfer (no calldata), returning the hash as soon as it is on the wire
// so callers can persist it before confirming.
export async function sendTransactionWithNonce(
  walletClient: WalletClient<HttpTransport, Chain, LocalAccount>,
  { to, value }: { to: `0x${string}`; value: bigint },
): Promise<`0x${string}`> {
  const { address } = walletClient.account;
  const transactionCount = await getEVMClient().getTransactionCount({ address });
  const nonce = await reserveNonce(address, transactionCount);
  const { hash } = await broadcastOnReservedNonce(walletClient, { to, value }, nonce);
  return hash;
}

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
  const [transactionCount] = await Promise.all([
    publicClient.getTransactionCount({
      address,
    }),
    publicClient.simulateContract(params as SimulateContractParameters),
  ]);
  const pendingNonce = await reserveNonce(address, transactionCount);

  try {
    const { hash, serializedTransaction } = await broadcastOnReservedNonce(walletClient, {
      ...otherParams,
      to: toAddress,
      data: encodeFunctionData({
        abi,
        functionName,
        args,
      }),
    }, pendingNonce);
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
