import BigNumber from 'bignumber.js';
import { Router } from 'express';
import LRUCache from 'lru-cache';
import Axios, { AxiosError } from 'axios';
import HttpAgent, { HttpsAgent } from 'agentkeepalive';

import { API_HOSTNAME, ONE_DAY_IN_MS, ONE_DAY_IN_S } from '../../../constant';

import {
  COSMOS_LCD_INDEXER_ENDPOINT,
  LIKER_NFT_TARGET_ADDRESS,
} from '../../../../config/config';

const classChainMetadataCache = new LRUCache({
  max: 1000,
  ttl: ONE_DAY_IN_MS,
});

const axios = Axios.create({
  httpAgent: new HttpAgent(),
  httpsAgent: new HttpsAgent(),
  timeout: 60000,
});

const router = Router();

async function getNFTClassChainMetadata(classId) {
  try {
    if (classChainMetadataCache.has(classId)) {
      return classChainMetadataCache.get(classId);
    }
    const { data } = await axios.get(
      `${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/nft/v1beta1/classes/${classId}`,
    );
    const {
      name,
      description,
      uri,
      data: { metadata, parent },
    } = data.class;
    const result = {
      name,
      description,
      uri,
      ...metadata,
      parent,
    };
    classChainMetadataCache.set(classId, result);
    return result;
  } catch (err) {
    const error = err as AxiosError;
    if (error.response && (error.response.data as any).code === 2) {
      // eslint-disable-next-line no-console
      throw new Error('NFT_CLASS_NOT_FOUND');
    }
    throw err;
  }
}

async function getNFTClassAPIMetadata(uri) {
  try {
    const { data } = await axios.get(uri);
    return data;
  } catch (err) {
    const error = err as AxiosError;
    if (error.response && error.response.status !== 404) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get API metadata from ${uri}`);
    }
    return null;
  }
}

async function getISCNMetadata(iscnId) {
  try {
    const { data } = await axios.get(
      `${COSMOS_LCD_INDEXER_ENDPOINT}/iscn/records/id?iscn_id=${iscnId}`,
    );
    const result = data.records[0].data;
    result.owner = data.owner;
    return result;
  } catch (err) {
    const error = err as AxiosError;
    if (error.response && error.response.status !== 404) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get ISCN data for ${iscnId}`);
    }
    return null;
  }
}

function isValidHttpUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    // no op
  }
  return false;
}

async function getNFTClassAndISCNMetadata(classId) {
  const chainMetadata = await getNFTClassChainMetadata(classId);

  const iscnId = chainMetadata.parent.iscn_id_prefix;
  const promises = [getISCNMetadata(iscnId)];

  const { uri } = chainMetadata;
  if (isValidHttpUrl(uri)) {
    promises.push(getNFTClassAPIMetadata(uri));
  }
  const [iscnData, apiMetadata] = await Promise.all(promises);

  const hasApiMetadata = !!apiMetadata && typeof apiMetadata === 'object'
    && !Array.isArray(apiMetadata)
    && apiMetadata !== null;

  const classData = hasApiMetadata
    ? { ...chainMetadata, ...apiMetadata }
    : chainMetadata;
  const iscnOwner = iscnData.owner;
  const accountOwner = chainMetadata.parent.account;
  if (iscnOwner) {
    classData.iscn_owner = iscnOwner;
  } else if (accountOwner) {
    classData.account_owner = accountOwner;
  }

  return [classData, iscnData];
}

function formatOwnerInfo(owners) {
  const ownerInfo = {};
  owners.forEach((o) => {
    const { owner, nfts } = o;
    if (owner !== LIKER_NFT_TARGET_ADDRESS) {
      ownerInfo[owner] = nfts;
    }
  });
  return ownerInfo;
}

async function getNFTClassOwnerInfo(classId) {
  const { data } = await axios.get(
    `${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/owner?class_id=${classId}`,
  );
  const { owners = [] } = data;
  const result = formatOwnerInfo(owners);
  return result;
}

function formatAndFilterListing(listings, ownerInfo) {
  const result = listings
    .map((l) => {
      const {
        class_id: classId, nft_id: nftId, seller, price, expiration,
      } = l;
      return {
        classId,
        nftId,
        seller,
        price: new BigNumber(price).shiftedBy(-9).toNumber(),
        expiration: new Date(expiration),
      };
    })
    .filter((l) => ownerInfo[l.seller]
      && ownerInfo[l.seller].includes(l.nftId)) // guard listing then sent case
    .sort((a, b) => a.price - b.price);
  return result;
}

async function getNFTClassOwnerInfoAndListingInfo(classId) {
  const [ownerInfo, listingInfo] = await Promise.all([
    getNFTClassOwnerInfo(classId),
    axios.get(`${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/listings/${classId}`),
  ]);
  const listingInput = listingInfo.data.listings || [];
  const listings = formatAndFilterListing(listingInput, ownerInfo);
  return [ownerInfo, listings];
}

async function getNFTClassPurchaseInfo(classId) {
  try {
    const { data } = await axios.get(
      `https://${API_HOSTNAME}/likernft/purchase?class_id=${classId}`,
    );
    return data || null;
  } catch (err) {
    const error = err as AxiosError;
    if (error.response && error.response.status === 404) {
      return null;
    }
    throw err;
  }
}

async function getNFTClassBookstoreInfo(classId) {
  try {
    const { data } = await axios.get(
      `https://${API_HOSTNAME}/likernft/book/store/${classId}`,
    );
    return data || null;
  } catch (err) {
    const error = err as AxiosError;
    if (
      error.response
      && (error.response.status === 400 || error.response.status === 404)
    ) {
      return null;
    }
    throw err;
  }
}

router.get('/nft/metadata', async (req, res, next) => {
  try {
    const { class_id: classId, data: inputSelected } = req.query;
    if (!classId) {
      res.status(400).send('MISSING_CLASS_ID');
      return;
    }

    const selectedSet = new Set(
      typeof inputSelected === 'string' ? [inputSelected as string] : inputSelected as string[],
    );
    if (
      ![
        'class_chain',
        'class_api',
        'iscn',
        'owner',
        'listing',
        'purchase',
        'bookstore',
      ].some((s) => selectedSet.has(s))
    ) {
      selectedSet.add('all');
    }

    const promises: Promise<any>[] = [];

    if (['all', 'class_api', 'iscn'].some((s) => selectedSet.has(s))) {
      promises.push(getNFTClassAndISCNMetadata(classId));
    } else if (selectedSet.has('class_chain')) {
      promises.push(Promise.all([getNFTClassChainMetadata(classId), null]));
    } else {
      promises.push(Promise.resolve([null, null]));
    }

    if (['all', 'listing'].some((s) => selectedSet.has(s))) {
      promises.push(getNFTClassOwnerInfoAndListingInfo(classId));
    } else if (selectedSet.has('owner')) {
      promises.push(Promise.all([getNFTClassOwnerInfo(classId), null]));
    } else {
      promises.push(Promise.resolve([null, null]));
    }

    if (['all', 'purchase'].some((s) => selectedSet.has(s))) {
      promises.push(getNFTClassPurchaseInfo(classId));
    } else {
      promises.push(Promise.resolve(null));
    }

    if (['all', 'bookstore'].some((s) => selectedSet.has(s))) {
      promises.push(getNFTClassBookstoreInfo(classId));
    } else {
      promises.push(Promise.resolve(null));
    }

    const [
      [classData, iscnData],
      [ownerInfo, listings],
      purchaseInfo,
      bookstoreInfo,
    ] = await Promise.all(promises);

    const result: any = {};
    if (['all', 'class_chain', 'class_api'].some((s) => selectedSet.has(s))) {
      result.classData = classData;
    }
    if (['all', 'iscn'].some((s) => selectedSet.has(s))) {
      result.iscnData = iscnData;
    }
    if (['all', 'owner'].some((s) => selectedSet.has(s))) {
      result.ownerInfo = ownerInfo;
    }
    if (['all', 'listing'].some((s) => selectedSet.has(s))) {
      result.listings = listings;
    }
    if (['all', 'purchase'].some((s) => selectedSet.has(s))) {
      result.purchaseInfo = purchaseInfo;
    }
    if (['all', 'bookstore'].some((s) => selectedSet.has(s))) {
      result.bookstoreInfo = bookstoreInfo;
    }

    res.set('Cache-Control', `public, max-age=60, stale-while-revalidate=${ONE_DAY_IN_S}`);
    res.json(result);
  } catch (err) {
    const error = err as AxiosError;
    if (error.message === 'NFT_CLASS_NOT_FOUND') {
      res.status(404).send(error.message);
    } else {
      next(err);
    }
  }
});

export default router;
