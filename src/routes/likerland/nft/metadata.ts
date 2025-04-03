import { Router } from 'express';
import LRUCache from 'lru-cache';
import Axios, { AxiosError } from 'axios';

import { INTERNAL_HOSTNAME, ONE_DAY_IN_MS, ONE_DAY_IN_S } from '../../../constant';

import {
  COSMOS_LCD_INDEXER_ENDPOINT,
  LIKER_NFT_TARGET_ADDRESS,
} from '../../../../config/config';
import { isEVMClassId, getNFTClassDataById as getEVMNFTClassDataById } from '../../../util/evm/nft';

const classChainMetadataCache = new LRUCache({
  max: 1000,
  ttl: ONE_DAY_IN_MS,
});

const axios = Axios.create({
  timeout: 60000,
});

const router = Router();

async function getNFTClassChainMetadata(classId) {
  try {
    if (classChainMetadataCache.has(classId)) {
      return classChainMetadataCache.get(classId);
    }
    let result;
    if (isEVMClassId(classId)) {
      result = await getEVMNFTClassDataById(classId);
    } else {
      const { data } = await axios.get(
        `${COSMOS_LCD_INDEXER_ENDPOINT}/cosmos/nft/v1beta1/classes/${classId}`,
      );
      const {
        name,
        description,
        uri,
        uri_hash: uriHash,
        data: { metadata = {}, parent = null } = {},
      } = data.class;
      result = {
        name,
        description,
        uri,
        uriHash,
        ...metadata,
        parent,
        iscnIdPrefix: parent?.iscn_id_prefix,
      };
    }
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

async function getISCNMetadata(iscnId) {
  try {
    const { data } = await axios.get(
      `${COSMOS_LCD_INDEXER_ENDPOINT}/iscn/records/id?iscn_id=${iscnId}`,
    );
    const result = data.records[0].data;
    if (!result) {
      return null;
    }
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

async function getNFTClassAndISCNMetadata(classId) {
  const chainMetadata = await getNFTClassChainMetadata(classId);

  const iscnId = chainMetadata.iscnIdPrefix;
  const promises = [iscnId ? getISCNMetadata(iscnId) : null];

  const [iscnData, apiMetadata] = await Promise.all(promises);

  const hasApiMetadata = !!apiMetadata && typeof apiMetadata === 'object'
    && !Array.isArray(apiMetadata)
    && apiMetadata !== null;

  const classData = hasApiMetadata
    ? { ...chainMetadata, ...apiMetadata }
    : chainMetadata;
  const iscnOwner = iscnData?.owner;
  const accountOwner = chainMetadata.parent?.account;
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
  if (isEVMClassId(classId)) {
    // TODO: Implement EVM owner info via indexer
    return null;
  }
  const { data } = await axios.get(
    `${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/owner?class_id=${classId}`,
  );
  const { owners = [] } = data;
  const result = formatOwnerInfo(owners);
  return result;
}

async function getNFTClassPurchaseInfo(classId) {
  try {
    const { data } = await axios.get(
      `http://${INTERNAL_HOSTNAME}/likernft/purchase?class_id=${classId}`,
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
      `http://${INTERNAL_HOSTNAME}/likernft/book/store/${classId}`,
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

    if (['all', 'owner'].some((s) => selectedSet.has(s))) {
      promises.push(getNFTClassOwnerInfo(classId));
    } else {
      promises.push(Promise.resolve(null));
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
      ownerInfo,
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
