import Arweave from 'arweave/node';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import stringify from 'fast-json-stable-stringify';
import {
  getFileIPFSHash,
  getFolderIPFSHash,
  uploadFileToIPFS,
} from './ipfs';
import { COINGECKO_AR_LIKE_PRICE_API } from '../constant';

const IPFS_KEY = 'IPFS-Add';

const IPFS_CONSTRAINT_KEY = 'standard';
const IPFS_CONSTRAINT = 'v0.1';

const jwk = require('../../config/arweave-key.json');

const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });

export async function getArweaveIdFromHashes(ipfsHash) {
  const res = await arweave.arql(
    {
      op: 'and',
      expr1: {
        op: 'equals',
        expr1: IPFS_KEY,
        expr2: ipfsHash,
      },
      expr2: {
        op: 'equals',
        expr1: IPFS_CONSTRAINT_KEY,
        expr2: IPFS_CONSTRAINT,
      },
    },
  );
  return res[0] || undefined;
}

function generateManifest(files, { stub = false } = {}) {
  const isIndexExists = !!files.find(f => f.key === 'index.html');
  let list = files;
  if (stub) {
    list = list.map(p => ({
      arweaveId: p.arweaveId || 'fzassxeg7cCmOp6-sVkvDV3l5GVfDqL_pF_VOQHHBGo',
      ...p,
    }));
  }
  const filePaths = list
    .filter(p => p.key && p.arweaveId)
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

function generateManifestFile(files, { stub = false } = {}) {
  const manifest = generateManifest(files, { stub });
  return {
    key: 'manifest',
    mimetype: 'application/x.arweave-manifest+json',
    buffer: Buffer.from(stringify(manifest), 'utf-8'),
  };
}

export async function estimateARPrice(data) {
  const { buffer, key } = data;
  const ipfsHash = await getFileIPFSHash(data);
  const id = await getArweaveIdFromHashes(ipfsHash);
  if (id) {
    return {
      key,
      arweaveId: id,
      AR: '0',
    };
  }
  const transaction = await arweave.createTransaction({ data: buffer }, jwk);
  const { reward } = transaction;
  return {
    key,
    AR: arweave.ar.winstonToAr(reward),
  };
}

export async function estimateARPrices(files) {
  if (files.length === 1) {
    return estimateARPrice(files[0]);
  }
  const prices = await Promise.all(files.map(f => estimateARPrice(f)));
  const filesWithPrice = files.map((f, i) => ({ ...f, arweaveId: prices[i].arweaveId }));
  const manifest = generateManifestFile(filesWithPrice, { stub: true });
  const manifestPrice = await estimateARPrice(manifest);

  prices.unshift(manifestPrice);
  const totalAR = prices.reduce((acc, cur) => acc.plus(cur.AR), new BigNumber(0));
  return {
    arweaveId: manifestPrice.arweaveId,
    AR: totalAR.toFixed(),
    list: prices,
  };
}

export async function convertARPriceToLIKE(ar, {
  priceRatio: inputPriceRatio = '', margin = 0.05, decimal = 0,
} = {}) {
  let priceRatio = inputPriceRatio;
  if (!priceRatio) {
    const { data } = await axios.get(COINGECKO_AR_LIKE_PRICE_API);
    const { likecoin, arweave: arweavePrice } = data;
    priceRatio = new BigNumber(arweavePrice.usd).dividedBy(likecoin.usd).toFixed();
  }
  // At least 1 LIKE for 1 AR
  const priceRatioBigNumber = BigNumber.max(priceRatio, 1);
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

export async function convertARPricesToLIKE(ar,
  { margin = 0.05, decimal = 0 } = {}) {
  if (!(ar.list && ar.list.length)) {
    return convertARPriceToLIKE(ar, { margin, decimal });
  }
  const newList = await Promise.all(ar.list.map(a => convertARPriceToLIKE(a, { margin, decimal })));
  const totalLIKE = newList.reduce((acc, cur) => acc.plus(cur.LIKE), new BigNumber(0));
  return {
    ...ar,
    LIKE: totalLIKE.toFixed(),
    list: newList,
  };
}

export async function submitToArweave(data, ipfsHash) {
  const anchorId = (await arweave.api.get('/tx_anchor')).data;
  const { mimetype, buffer } = data;
  const transaction = await arweave.createTransaction({ data: buffer, last_tx: anchorId }, jwk);
  transaction.addTag('User-Agent', 'app.like.co');
  transaction.addTag(IPFS_KEY, ipfsHash);
  transaction.addTag(IPFS_CONSTRAINT_KEY, IPFS_CONSTRAINT);
  transaction.addTag('Content-Type', mimetype);
  const { reward } = transaction;

  const balance = await arweave.wallets.getBalance(await arweave.wallets.jwkToAddress(jwk));
  if (arweave.ar.isLessThan(balance, reward)) return '';

  await arweave.transactions.sign(transaction, jwk);
  await arweave.transactions.post(transaction);
  return transaction.id;
}

export async function uploadFileToArweave(data) {
  const ipfsHash = await getFileIPFSHash(data);
  const id = await getArweaveIdFromHashes(ipfsHash);
  if (id) {
    return {
      arweaveId: id,
      ipfsHash,
      list: undefined,
    };
  }
  const [res] = await Promise.all([
    submitToArweave(data, ipfsHash),
    uploadFileToIPFS(data.buffer),
  ]);
  return {
    arweaveId: res,
    ipfsHash,
    list: undefined,
  };
}

async function uploadManifestFile(filesWithId) {
  const manifest = generateManifestFile(filesWithId);
  const manifestIPFSHash = await getFileIPFSHash(manifest);
  let arweaveId = await getArweaveIdFromHashes(manifestIPFSHash);
  if (!arweaveId) {
    [arweaveId] = await Promise.all([
      submitToArweave(manifest, manifestIPFSHash),
      uploadFileToIPFS(manifest.buffer),
    ]);
  }
  manifest.arweaveId = arweaveId;
  return { manifest, ipfsHash: manifestIPFSHash, arweaveId };
}

export async function uploadFilesToArweave(files) {
  if (files.length === 1) {
    return uploadFileToArweave(files[0]);
  }

  const [
    folderIpfsHash,
    ipfsHashes,
  ] = await Promise.all([
    getFolderIPFSHash(files),
    Promise.all(files.map(f => getFileIPFSHash(f))),
  ]);
  const arweaveIds = await Promise.all(ipfsHashes.map(h => getArweaveIdFromHashes(h)));
  if (!arweaveIds.some(id => !id)) {
    const filesWithId = files.map((f, i) => ({ ...f, arweaveId: arweaveIds[i] }));
    const { manifest, ipfsHash: manifestIPFSHash } = await uploadManifestFile(filesWithId);
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

  const list = [];
  const filesWithId = [];
  for (let i = 0; i < files.length; i += 1) {
    /* eslint-disable no-await-in-loop */
    const f = files[i];
    const { buffer } = f;
    const ipfsHash = await getFileIPFSHash(f);
    const [arweaveId] = await Promise.all([
      submitToArweave(f, ipfsHash),
      uploadFileToIPFS(buffer),
    ]);
    list.push({
      key: f.key,
      arweaveId,
      ipfsHash,
    });
    filesWithId.push({ ...f, arweaveId });
    /* eslint-enable no-await-in-loop */
  }
  const { manifest, ipfsHash } = await uploadManifestFile(filesWithId);
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
