import Arweave from 'arweave/node';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import stringify from 'fast-json-stable-stringify';
import LRU from 'lru-cache';
import {
  getFileIPFSHash,
  getFolderIPFSHash,
  uploadFileToIPFS,
} from './ipfs';
import { COINGECKO_AR_LIKE_PRICE_API, IS_TESTNET } from '../constant';

const arweaveIdCache = new LRU({ max: 4096, maxAge: 86400000 }); // 1day

const IPFS_KEY = 'IPFS-Add';

const IPFS_CONSTRAINT_KEY = 'standard';
const IPFS_CONSTRAINT = 'v0.1';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwk = require('../../config/arweave-key.json');

const arweaveGraphQL = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
  timeout: 5000,
});

const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
  timeout: 60000,
});

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
  const transaction = await arweave.createTransaction({
    data: buffer,
    last_tx: 'stub_for_estimate',
  }, jwk);
  const { reward } = transaction;
  return {
    key,
    AR: arweave.ar.winstonToAr(reward),
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

async function getPriceRatioBigNumber() {
  try {
    const { data } = await axios.get(COINGECKO_AR_LIKE_PRICE_API, { timeout: 10000 });
    const { likecoin, arweave: arweavePrice } = data;
    const priceRatio = new BigNumber(arweavePrice.usd).dividedBy(likecoin.usd).toFixed();
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

export async function convertARPricesToLIKE(
  ar,
  { margin = 0.05, decimal = 0 } = {},
) {
  const priceRatioBigNumber = await getPriceRatioBigNumber();
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

export async function submitToArweave(data, ipfsHash, { anchorId }: { anchorId?: string } = {}) {
  const anchor = anchorId || (await arweave.api.get('/tx_anchor')).data;
  const { mimetype, buffer } = data;
  const transaction = await arweave.createTransaction({
    data: buffer, last_tx: anchor,
  }, jwk);
  transaction.addTag('User-Agent', 'api.like.co');
  transaction.addTag(IPFS_KEY, ipfsHash);
  transaction.addTag(IPFS_CONSTRAINT_KEY, IPFS_CONSTRAINT);
  transaction.addTag('Content-Type', mimetype);
  const { reward } = transaction;

  if (!IS_TESTNET) {
    const balance = await arweave.wallets.getBalance(await arweave.wallets.jwkToAddress(jwk));
    if (arweave.ar.isLessThan(balance, reward)) throw new Error('INSUFFICIENT_AR_IN_PROXY');
  }

  await arweave.transactions.sign(transaction, jwk);
  await arweave.transactions.post(transaction);
  arweaveIdCache.set(ipfsHash, transaction.id);
  return transaction.id;
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

async function uploadManifestFile(filesWithId, { anchorId, checkDuplicate = true }) {
  const manifest: any = await generateManifestFile(filesWithId);
  const manifestIPFSHash = await getFileIPFSHash(manifest);
  let arweaveId;
  if (checkDuplicate) arweaveId = await getArweaveIdFromHashes(manifestIPFSHash);
  if (!arweaveId) {
    [arweaveId] = await Promise.all([
      submitToArweave(manifest, manifestIPFSHash, { anchorId }),
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
  const anchorId = (await arweave.api.get('/tx_anchor')).data;
  if (!arweaveIds.some((id) => !id)) {
    const filesWithId = files.map((f, i) => ({ ...f, arweaveId: arweaveIds[i] }));
    const {
      manifest, ipfsHash: manifestIPFSHash,
    } = await uploadManifestFile(filesWithId, { checkDuplicate, anchorId });
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
        submitToArweave(f, ipfsHash, {
          anchorId,
        }),
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
    { anchorId, checkDuplicate: false },
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
