import Arweave from 'arweave/node';
import BigNumber from 'bignumber.js';
import stringify from 'fast-json-stable-stringify';
import LRU from 'lru-cache';
import {
  getFileIPFSHash,
  getFolderIPFSHash,
  uploadFileToIPFS,
} from '../ipfs';
import { getMaticBundlr } from './signer';
import { IS_TESTNET } from '../../constant';
import { getMaticPriceInLIKE, getArweavePriceInLIKE } from '../api/likernft/likePrice';
import { LIKE_PRICE_MULTIPLIER } from '../../../config/config';

const arweaveIdCache = new LRU({ max: 4096, maxAge: 86400000 }); // 1day

const IPFS_KEY = 'IPFS-Add';

const IPFS_CONSTRAINT_KEY = 'standard';
const IPFS_CONSTRAINT = 'v0.1';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwk = require('../../../config/arweave-key.json');

const arweaveGraphQL = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
  timeout: 5000,
});

// eslint-disable-next-line no-underscore-dangle
let _bundlr;

async function getBundlr() {
  if (!_bundlr) {
    // eslint-disable-next-line global-require
    global.crypto = require('crypto'); // hack for bundlr
    const { NodeBundlr } = await (import('@bundlr-network/client'));
    _bundlr = new NodeBundlr(
      IS_TESTNET ? 'https://node2.irys.xyz' : 'https://node1.irys.xyz',
      'arweave',
      jwk,
    );
  }
  return _bundlr;
}

export async function getArweaveIdFromHashes(ipfsHash) {
  const cachedInfo = arweaveIdCache.get(ipfsHash);
  if (cachedInfo) return cachedInfo;
  try {
    const res = await arweaveGraphQL.api.post('/graphql', {
      query: `
    {
      transactions(
        tags: [
          { name: "${IPFS_KEY}", values: ["${ipfsHash}"] },
          { name: "${IPFS_CONSTRAINT_KEY}", values: ["${IPFS_CONSTRAINT}"] }
        ]
      ) {
        edges {
          node {
            id
          }
        }
      }
    }`,
    });
    const ids = res.data.data.transactions.edges;
    if (ids[0]) {
      const { id } = ids[0].node;
      arweaveIdCache.set(ipfsHash, id);
      return id;
    }
    return undefined;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return undefined;
  }
}

async function generateManifest(files, { stub = false } = {}) {
  const isIndexExists = !!files.find((f) => f.key === 'index.html');
  let list = files;
  if (stub) {
    // stub some string as arweave id for estimation
    list = await Promise.all(list.map(async (p) => {
      let { arweaveId } = p;
      if (!arweaveId) {
        if (p.buffer) {
          arweaveId = await getFileIPFSHash(p);
        } else {
          arweaveId = 'fzassxeg7cCmOp6-sVkvDV3l5GVfDqL_pF_VOQHHBGo';
        }
      }
      return {
        ...p,
        arweaveId,
      };
    }));
  }
  const filePaths = list
    .filter((p) => p.key && p.arweaveId)
    .reduce((acc, p) => {
      acc[p.key] = {
        id: p.arweaveId,
      };
      return acc;
    }, {});
  const manifest = {
    manifest: 'arweave/paths',
    version: '0.1.0',
    index: isIndexExists ? {
      path: 'index.html',
    } : undefined,
    paths: filePaths,
  };
  return manifest;
}

async function generateManifestFile(files, { stub = false } = {}) {
  const manifest = await generateManifest(files, { stub });
  return {
    key: 'manifest',
    mimetype: 'application/x.arweave-manifest+json',
    buffer: Buffer.from(stringify(manifest), 'utf-8'),
  };
}

export async function estimateARV2MaticPrice(fileSize, ipfsHash, { checkDuplicate = true } = {}) {
  if (checkDuplicate) {
    const id = await getArweaveIdFromHashes(ipfsHash);
    if (id) {
      return {
        arweaveId: id,
        MATIC: '0',
        wei: '0',
      };
    }
  }
  const maticBundlr = await getMaticBundlr();
  const priceAtomic = await maticBundlr.getPrice(fileSize);
  const priceConverted = maticBundlr.utils.fromAtomic(priceAtomic);
  return {
    MATIC: priceConverted.toFixed(),
    wei: priceAtomic.toFixed(),
  };
}

export async function estimateARPrice(data, checkDuplicate = true) {
  const { buffer, key } = data;
  const ipfsHash = await getFileIPFSHash(data);
  if (checkDuplicate) {
    const id = await getArweaveIdFromHashes(ipfsHash);
    if (id) {
      return {
        key,
        arweaveId: id,
        AR: '0',
      };
    }
  }
  const bundlr = await getBundlr();
  const priceAtomic = await bundlr.getPrice(buffer.byteLength);
  const priceConverted = bundlr.utils.fromAtomic(priceAtomic);
  return {
    key,
    AR: priceConverted.toFixed(),
  };
}

export async function estimateARPrices(files, checkDuplicate = true): Promise<{
  key?: string;
  arweaveId?: string;
  AR: string;
  list?: any[];
}> {
  if (files.length === 1) {
    return estimateARPrice(files[0], checkDuplicate);
  }
  const prices = await Promise.all(files.map((f) => estimateARPrice(f, checkDuplicate)));
  const filesWithPrice = files.map((f, i) => ({ ...f, arweaveId: prices[i].arweaveId }));
  const checkManifestDuplicate = checkDuplicate && !filesWithPrice.find((p) => !p.arweaveId);
  const manifest = await generateManifestFile(filesWithPrice, { stub: true });
  const manifestPrice = await estimateARPrice(manifest, checkManifestDuplicate);

  prices.unshift(manifestPrice);
  const totalAR = prices.reduce((acc, cur) => acc.plus(cur.AR), new BigNumber(0));
  return {
    arweaveId: manifestPrice.arweaveId,
    AR: totalAR.toFixed(),
    list: prices,
  };
}

async function getARPriceRatioBigNumber() {
  try {
    const priceRatio = await getArweavePriceInLIKE();
    // At least 1 LIKE for 1 AR
    const priceRatioBigNumber = BigNumber.max(priceRatio, 1);
    return priceRatioBigNumber;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(err));
    // TODO: make a less hardcoded fallback price
    return new BigNumber(5000);
  }
}

async function getMATICPriceRatioBigNumber() {
  try {
    const priceRatio = await getMaticPriceInLIKE();
    // At least 1 LIKE for 1 AR
    const priceRatioBigNumber = BigNumber.max(priceRatio, 1);
    return priceRatioBigNumber;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(err));
    // TODO: make a less hardcoded fallback price
    return new BigNumber(700);
  }
}

export function convertARPriceToLIKE(ar, {
  priceRatioBigNumber, margin = 0.05, decimal = 0,
}) {
  const res = new BigNumber(ar.AR)
    .multipliedBy(priceRatioBigNumber)
    .multipliedBy(1 + margin)
    .toFixed(decimal, BigNumber.ROUND_UP);
  // list should be empty, but make ts happy
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { list, ...payload } = ar;
  return {
    ...payload,
    LIKE: res,
  };
}

export async function convertMATICPriceToLIKE(matic, {
  margin = 0.05, decimal = 0,
} = {}) {
  const priceRatioBigNumber = await getMATICPriceRatioBigNumber();
  const res = new BigNumber(matic)
    .multipliedBy(priceRatioBigNumber)
    .multipliedBy(LIKE_PRICE_MULTIPLIER || 1)
    .multipliedBy(1 + margin)
    .toFixed(decimal, BigNumber.ROUND_UP);
  return {
    LIKE: res,
  };
}

export async function convertARPricesToLIKE(
  ar,
  { margin = 0.05, decimal = 0 } = {},
) {
  const priceRatioBigNumber = await getARPriceRatioBigNumber();
  if (!(ar.list && ar.list.length)) {
    return convertARPriceToLIKE(ar, { priceRatioBigNumber, margin, decimal });
  }
  const newList = ar.list.map(
    (a) => convertARPriceToLIKE(a, { priceRatioBigNumber, margin, decimal }),
  );
  const totalLIKE = newList.reduce((acc, cur) => acc.plus(cur.LIKE), new BigNumber(0));
  return {
    ...ar,
    LIKE: totalLIKE.toFixed(),
    list: newList,
  };
}

export async function submitToArweave(data, ipfsHash) {
  const { mimetype, buffer } = data;
  const tags = [
    { name: 'App-Name', value: 'app.like.co' },
    { name: 'App-Version', value: '1.0' },
    { name: 'User-Agent', value: 'app.like.co' },
    { name: IPFS_KEY, value: ipfsHash },
    { name: IPFS_CONSTRAINT_KEY, value: IPFS_CONSTRAINT },
    { name: 'Content-Type', value: mimetype },
  ];

  const bundlr = await getBundlr();
  if (!IS_TESTNET) {
    const priceAtomic = await bundlr.getPrice(buffer.byteLength);
    const atomicBalance = await bundlr.getLoadedBalance();
    if (atomicBalance.isLessThan(priceAtomic)) throw new Error('INSUFFICIENT_AR_IN_PROXY');
  }

  const response = await bundlr.upload(buffer, { tags });
  return response.id;
}

export async function uploadFileToArweave(data, checkDuplicate = true) {
  const ipfsHash = await getFileIPFSHash(data);
  if (checkDuplicate) {
    const id = await getArweaveIdFromHashes(ipfsHash);
    if (id) {
      return {
        arweaveId: id,
        ipfsHash,
        list: undefined,
      };
    }
  }
  const [res] = await Promise.all([
    submitToArweave(data, ipfsHash),
    uploadFileToIPFS(data),
  ]);
  return {
    arweaveId: res,
    ipfsHash,
    list: undefined,
  };
}

async function uploadManifestFile(filesWithId, { checkDuplicate = true }) {
  const manifest: any = await generateManifestFile(filesWithId);
  const manifestIPFSHash = await getFileIPFSHash(manifest);
  let arweaveId;
  if (checkDuplicate) arweaveId = await getArweaveIdFromHashes(manifestIPFSHash);
  if (!arweaveId) {
    [arweaveId] = await Promise.all([
      submitToArweave(manifest, manifestIPFSHash),
      uploadFileToIPFS(manifest),
    ]);
  }
  manifest.arweaveId = arweaveId;
  return { manifest, ipfsHash: manifestIPFSHash, arweaveId };
}

export async function uploadFilesToArweave(files, arweaveIdList, checkDuplicate = true) {
  if (files.length === 1) {
    return uploadFileToArweave(files[0], checkDuplicate);
  }

  const [
    folderIpfsHash,
    ipfsHashes,
  ] = await Promise.all([
    getFolderIPFSHash(files),
    Promise.all(files.map((f) => getFileIPFSHash(f))),
  ]);
  let arweaveIds = arweaveIdList;
  if (!arweaveIds) {
    if (checkDuplicate) {
      arweaveIds = await Promise.all(ipfsHashes.map((h) => getArweaveIdFromHashes(h)));
    } else {
      arweaveIds = new Array(files.length);
    }
  }
  if (!arweaveIds.some((id) => !id)) {
    const filesWithId = files.map((f, i) => ({ ...f, arweaveId: arweaveIds[i] }));
    const {
      manifest, ipfsHash: manifestIPFSHash,
    } = await uploadManifestFile(filesWithId, { checkDuplicate });
    const list = filesWithId.map((f, index) => ({
      key: f.key,
      arweaveId: arweaveIds[index],
      ipfsHash: ipfsHashes[index],
    }));
    list.unshift({
      key: manifest.key,
      arweaveId: manifest.arweaveId,
      ipfsHash: manifestIPFSHash,
    });
    return {
      arweaveId: manifest.arweaveId,
      ipfsHash: folderIpfsHash,
      list,
    };
  }

  const list = await Promise.all(files.map(async (f, i) => {
    let arweaveId = arweaveIds[i];
    let ipfsHash = ipfsHashes[i];
    if (!ipfsHash) {
      ipfsHash = await getFileIPFSHash(f);
    }
    if (!arweaveId) {
      [arweaveId] = await Promise.all([
        submitToArweave(f, ipfsHash),
        uploadFileToIPFS(f),
      ]);
    }
    return {
      key: f.key,
      arweaveId,
      ipfsHash,
    };
  }));
  const filesWithId = files.map((f, i) => ({ ...f, arweaveId: list[i].arweaveId }));
  /* HACK: do not check manifest duplicate, assume new since we uploaded new file to arweave */
  const { manifest, ipfsHash } = await uploadManifestFile(
    filesWithId,
    { checkDuplicate: false },
  );
  list.unshift({
    key: manifest.key,
    arweaveId: manifest.arweaveId,
    ipfsHash,
  });
  return {
    arweaveId: manifest.arweaveId,
    ipfsHash: folderIpfsHash,
    list,
  };
}
