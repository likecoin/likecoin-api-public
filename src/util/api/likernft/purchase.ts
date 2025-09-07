import {
  getLikerNFTSigningClient, getLikerNFTSigningAddressInfo,
} from '../../cosmos/nft';
import {
  calculateTxGasFee,
  getSigningFunction,
  sendTransactionWithSequence,
} from '../../cosmos/tx';
import {
  NFT_COSMOS_DENOM,
  LIKER_NFT_DECAY_START_BATCH,
  LIKER_NFT_STARTING_PRICE,
  LIKER_NFT_PRICE_MULTIPLY,
  LIKER_NFT_DECAY_END_BATCH,
  LIKER_NFT_PRICE_DECAY,
} from '../../../../config/config';
import { ValidationError } from '../../ValidationError';

export function getNFTBatchInfo(batchNumber) {
  if (batchNumber === -1) { // free wnft
    return {
      price: 0,
      count: -1,
    };
  }
  const count = batchNumber + 1;
  const baseMultiplier = Math.min(batchNumber, LIKER_NFT_DECAY_START_BATCH);
  let price = LIKER_NFT_STARTING_PRICE * (LIKER_NFT_PRICE_MULTIPLY ** baseMultiplier);
  const decayMultiplier = Math.min(
    LIKER_NFT_DECAY_END_BATCH - LIKER_NFT_DECAY_START_BATCH,
    Math.max(batchNumber - LIKER_NFT_DECAY_START_BATCH, 0),
  );
  let lastPrice = price;
  for (let i = 1; i <= decayMultiplier; i += 1) {
    price += Math.round(lastPrice * (1 - LIKER_NFT_PRICE_DECAY * i));
    lastPrice = price;
  }
  return {
    price,
    count,
  };
}

export async function handleNFTPurchaseTransaction(txMessages, memo) {
  let res;
  const signingClient = await getLikerNFTSigningClient();
  const client = signingClient.getSigningStargateClient();
  if (!client) throw new Error('CANNOT_GET_SIGNING_CLIENT');
  const fee = calculateTxGasFee(txMessages.length, NFT_COSMOS_DENOM);
  const { address, accountNumber } = await getLikerNFTSigningAddressInfo();
  const txSigningFunction = getSigningFunction({
    signingStargateClient: client,
    address,
    messages: txMessages,
    fee,
    memo,
    accountNumber,
  });
  try {
    res = await sendTransactionWithSequence(
      address,
      txSigningFunction,
      client,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    throw new ValidationError(err);
  }
  const { transactionHash, code, rawLog } = res;
  if (code !== 0) {
    // eslint-disable-next-line no-console
    console.error(`Tx ${transactionHash} failed with code ${code}`);
    if (code === 4 && rawLog.includes('is not the owner of nft')) {
      const nftId = rawLog.split(' ').find((s) => s.startsWith('writing-')).split(':')[0];
      throw new ValidationError(
        'NFT_NOT_OWNED_BY_API_WALLET',
        409,
        { nftId },
      );
    } else {
      throw new ValidationError('TX_NOT_SUCCESS');
    }
  }

  return transactionHash;
}
