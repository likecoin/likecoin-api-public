import {
  type WriteContractParameters,
  type WalletClient,
} from 'viem';
import { waitForTransactionReceipt } from 'viem/actions';
import { db, txCollection as txLogRef } from '../firebase';
import { getEvmClient } from './client';
import publisher from '../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';

export async function sendWriteContractWithNonce(
  walletClient: WalletClient,
  params: WriteContractParameters,
) {
  const publicClient = getEvmClient();
  let res;
  let signedTx;
  if (!walletClient.account) {
    throw new Error('Wallet client does not have account');
  }
  const { address } = walletClient.account;
  const [transactionCount] = await Promise.all([
    publicClient.getTransactionCount({
      address,
    }),
    await publicClient.simulateContract(params),
  ]);
  const counterRef = txLogRef.doc(`!counter_${address}`);
  const pendingNonce = await db.runTransaction(async (t) => {
    const d = await t.get(counterRef);
    if (!d.data()) {
      const count = transactionCount;
      await t.create(counterRef, { value: count + 1 });
      return count;
    }
    const v = d.data().value + 1;
    await t.update(counterRef, { value: v });
    return v - 1;
  });

  try {
    const hash = await walletClient.writeContract({
      ...params,
      nonce: pendingNonce,
    });
    await db.runTransaction((t) => t.get(counterRef).then((d) => {
      if (pendingNonce + 1 > d.data().value) {
        return t.update(counterRef, {
          value: pendingNonce + 1,
        });
      }
      return Promise.resolve();
    }));
    if (!hash) {
      throw new Error('Transaction hash is not returned');
    }
    res = await publicClient.waitForTransactionReceipt({ hash });
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
  return {
    result: res,
    tx: signedTx,
    transactionHash: res.transactionHash,
    address,
    nonce: pendingNonce,
  };
}

export default sendWriteContractWithNonce;
