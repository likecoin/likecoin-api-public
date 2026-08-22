import { Router } from 'express';
import Axios, { AxiosError } from 'axios';

import { BOOK_PENDING_REVIEW_ERROR, INTERNAL_HOSTNAME, ONE_DAY_IN_S } from '../../../constant';

import {
  COSMOS_LCD_INDEXER_ENDPOINT,
  LIKER_NFT_TARGET_ADDRESS,
} from '../../../../config/config';
import {
  isEVMClassId,
  getNFTClassDataById as getEVMNFTClassDataById,
  getNFTClassOwner,
  getTokenAccountsByBookNFT,
} from '../../../util/evm/nft';
import type { NFTBookListingInfoFiltered } from '../../../types/book';
import { validateQuery } from '../../../middleware/validate';
import {
  NFTAggregatedMetadataQuerySchema,
  NFTAggregatedMetadataResponseSchema,
} from '../../../util/api/likerland/schemas';
import { sendValidatedJSON } from '../../../util/ValidationHelper';

const axios = Axios.create({
  timeout: 60000,
});

interface BookstoreInfoResult {
  info: NFTBookListingInfoFiltered | null;
  isPendingReview: boolean;
}

const router = Router();

async function getNFTClassChainMetadata(classId) {
  try {
    let result;
    if (isEVMClassId(classId)) {
      const [metadata, owner] = await Promise.all([
        getEVMNFTClassDataById(classId),
        getNFTClassOwner(classId),
      ]);
      result = {
        ...metadata,
        owner_address: owner,
      };
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
    return result;
  } catch (err) {
    const error = err as AxiosError;
    if (error.response && (error.response.data as { code?: number }).code === 2) {
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
  return owners
    .map((o) => o.owner)
    .filter((owner) => owner !== LIKER_NFT_TARGET_ADDRESS);
}

async function getNFTClassOwnerInfo(classId) {
  if (isEVMClassId(classId)) {
    const { data } = await getTokenAccountsByBookNFT(classId);
    const ownersInfo = data.map((item) => item.evm_address);
    return ownersInfo;
  }
  const { data } = await axios.get(
    `${COSMOS_LCD_INDEXER_ENDPOINT}/likechain/likenft/v1/owner?class_id=${classId}`,
  );
  const { owners = [] } = data;
  const result = formatOwnerInfo(owners);
  return result;
}

// Anonymous callers get `info: null` plus the pending flag, which says a listing exists
// and is unapproved without disclosing any of its contents.
async function getNFTClassBookstoreInfo(classId, authorization?: string) {
  try {
    const { data } = await axios.get(
      `http://${INTERNAL_HOSTNAME}/likernft/book/store/${classId}`,
      authorization ? { headers: { Authorization: authorization } } : undefined,
    );
    return { info: data || null, isPendingReview: false };
  } catch (err) {
    const error = err as AxiosError;
    const status = error.response?.status;
    // A stale or malformed token must not cost the caller the public listing:
    // fall back to the anonymous view instead of failing the whole request.
    if (authorization && (status === 401 || status === 403)) {
      return getNFTClassBookstoreInfo(classId, undefined);
    }
    if (status === 400 || status === 404) {
      return { info: null, isPendingReview: error.response?.data === BOOK_PENDING_REVIEW_ERROR };
    }
    throw err;
  }
}

router.get('/metadata', validateQuery(NFTAggregatedMetadataQuerySchema), async (req, res, next) => {
  try {
    const { class_id: rawClassId, data: inputSelected } = req.query;
    const { authorization } = req.headers;
    const classId = typeof rawClassId === 'string' ? rawClassId.toLowerCase() : rawClassId;
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
        'bookstore',
      ].some((s) => selectedSet.has(s))
    ) {
      selectedSet.add('all');
    }

    const isBookstoreRequested = ['all', 'bookstore'].some((s) => selectedSet.has(s));

    const promises: Array<Promise<unknown>> = [];

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

    if (isBookstoreRequested) {
      promises.push(getNFTClassBookstoreInfo(classId, authorization));
    } else {
      promises.push(Promise.resolve({ info: null, isPendingReview: false }));
    }

    const results = await Promise.allSettled(promises);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const error: Error = result.reason;
        let errorMessage = error.message;
        if (Axios.isAxiosError(error) && error.response) {
          errorMessage = JSON.stringify(error.response.data) || error.response.statusText;
        }
        // eslint-disable-next-line no-console
        console.error(`Promise at index ${index} rejected:`, errorMessage);
      }
    });
    const hasAnyError = results.some((result) => result.status === 'rejected');

    const [
      classAndIscnResult,
      ownerInfoResult,
      bookstoreInfoResult,
    ] = results.map((result) => (result.status === 'fulfilled' ? result.value : null));

    const classData = classAndIscnResult ? classAndIscnResult[0] : null;
    const iscnData = classAndIscnResult ? classAndIscnResult[1] : null;
    const ownerInfo = ownerInfoResult;
    const bookstoreResult = bookstoreInfoResult as BookstoreInfoResult | null;
    const bookstoreInfo = bookstoreResult?.info || null;

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
    if (isBookstoreRequested) {
      result.bookstoreInfo = bookstoreInfo;
      result.isBookstorePendingReview = !!bookstoreResult?.isPendingReview;
    }

    if (authorization && isBookstoreRequested) {
      // The payload may carry owner-only fields (and an otherwise hidden
      // pending-review listing), so it must never reach a shared cache.
      res.set('Cache-Control', 'no-store');
    } else if (bookstoreInfo?.evmClassId || bookstoreInfo?.redirectClassId) {
      res.set('Cache-Control', `public, max-age=${ONE_DAY_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}`);
    } else if (!hasAnyError) {
      res.set('Cache-Control', `public, max-age=60, stale-while-revalidate=${ONE_DAY_IN_S}`);
    }
    sendValidatedJSON(res, NFTAggregatedMetadataResponseSchema, result);
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
