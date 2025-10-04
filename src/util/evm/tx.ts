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
    const data = d.data();
    if (!data) {
      const count = transactionCount;
      await t.create(counterRef, { value: count + 1 });
      return count;
    }
    const v = (data.value as number) + 1;
    await t.update(counterRef, { value: v });
    return v - 1;
  });

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
    res = await publicClient.waitForTransactionReceipt({ hash });
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
