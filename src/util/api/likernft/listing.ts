import axios from 'axios';
import BigNumber from 'bignumber.js';
import { DeliverTxResponse } from '@cosmjs/stargate';
import { formatMsgSend, formatMsgBuyNFT } from '@likecoin/iscn-js/dist/messages/likenft';

import { getLikerNFTFiatSigningClientAndWallet } from '../../cosmos/nft';
import { calculateTxGasFee } from '../../cosmos/tx';
import { ValidationError } from '../../ValidationError';
import publisher from '../../gcloudPub';

import {
  COSMOS_LCD_INDEXER_ENDPOINT,
  NFT_COSMOS_DENOM,
} from '../../../../config/config';
import { PUBSUB_TOPIC_MISC } from '../../../constant';

export function formatListingInfo(info: {
  // eslint-disable-next-line camelcase
  class_id: string;
  // eslint-disable-next-line camelcase
  nft_id: string;
  seller: string;
  price: string;
  expiration: string;
}) {
  const {
    class_id: classId,
    nft_id: nftId,
    seller,
    price,
    expiration,
  } = info;
  return {
    classId,
    nftId,
    seller,
    price: new BigNumber(price).shiftedBy(-9).toNumber(),
    expiration: new Date(expiration),
  };
}

export async function fetchNFTListingInfo(classId: string) {
  const { data } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/listings/${classId}`);
  const info = data.listings;
  return info;
}

export async function fetchNFTListingInfoByNFTId(classId: string, nftId: string) {
  const { data } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/listings/${classId}/${nftId}`);
  const info = data.listings[0];
  return info || null;
}

async function handleNFTBuyListingTransaction({
  buyerWallet,
  classId,
  nftId,
  sellerWallet,
  price,
  memo = '',
}: {
  buyerWallet: string;
  classId: string;
  nftId: string;
  sellerWallet: string;
  price: string;
  memo?: string;
}) {
  const { client, wallet } = await getLikerNFTFiatSigningClientAndWallet();
  const fiatWallet = wallet.address;
  const txMessages = [
    formatMsgBuyNFT(
      fiatWallet,
      classId,
      nftId,
      sellerWallet,
      price,
    ),
    formatMsgSend(
      fiatWallet,
      buyerWallet,
      classId,
      nftId,
    ),
  ];
  const fee = calculateTxGasFee(txMessages.length, NFT_COSMOS_DENOM);
  const res = await client.sendMessages(fiatWallet, txMessages, { fee, memo });
  return res as DeliverTxResponse;
}

export async function processNFTBuyListing({
  buyerWallet,
  iscnPrefix,
  classId,
  nftId,
  sellerWallet,
  priceInLIKE,
  memo = '',
}: {
  buyerWallet: string;
  iscnPrefix: string;
  classId: string;
  nftId: string;
  sellerWallet: string;
  priceInLIKE: number;
  memo?: string;
}, req) {
  const listingInfo = await fetchNFTListingInfoByNFTId(classId, nftId);
  if (!listingInfo) throw new ValidationError('LISTING_NOT_FOUND');
  const { price: actualNftPrice } = listingInfo;
  const actualPriceInLIKE = new BigNumber(actualNftPrice).shiftedBy(-9);
  if (new BigNumber(priceInLIKE).lt(actualPriceInLIKE)) throw new ValidationError('LISTING_PRICE_NOT_MATCH');

  try {
    const res = await handleNFTBuyListingTransaction({
      buyerWallet,
      classId,
      nftId,
      sellerWallet,
      price: actualNftPrice,
      memo,
    });
    const { transactionHash, code } = res;
    if (code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`Tx ${transactionHash} failed with code ${code}`);
      throw new ValidationError('TX_NOT_SUCCESS');
    }
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTBuyListingTransaction',
      txHash: transactionHash,
      iscnId: iscnPrefix,
      classId,
      nftId,
      buyerWallet,
    });
    return { transactionHash, nftId, nftPrice: actualNftPrice };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTBuyListingError',
      iscnId: iscnPrefix,
      classId,
      nftId,
      buyerWallet,
    });
    throw err;
  }
}
