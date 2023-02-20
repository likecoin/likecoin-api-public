import axios from 'axios';
import BigNumber from 'bignumber.js';
import { getLikerNFTSigningClient } from '../../cosmos/nft';
import { COSMOS_LCD_INDEXER_ENDPOINT } from '../../../../config/config';

export async function fetchNFTListingInfo(classId: string) {
  const { data } = await axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/listings/${classId}`);
  const info = data.listings
    .map((l) => {
      const {
        nft_id: nftId,
        seller,
        price,
        expiration,
      } = l;
      return {
        classId,
        nftId,
        seller,
        price: new BigNumber(price).shiftedBy(-9).toNumber(),
        expiration: new Date(expiration),
      };
    })
    .sort((a, b) => a.price - b.price);
  return info;
}
