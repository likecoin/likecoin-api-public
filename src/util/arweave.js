import Arweave from 'arweave/node';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import { getIPFSHash, uploadToIPFS } from './ipfs';
import { COINGECKO_AR_LIKE_PRICE_API } from '../constant';

const IPFS_KEY = 'IPFS-Add';

const IPFS_CONSTRAINT_KEY = 'standard';
const IPFS_CONSTRAINT = 'v0.1';

const jwk = require('../../config/arweave-key.json');

const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });

export async function getArIdFromHashes(ipfsHash) {
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
  return res[0] || null;
}

export async function estimateARPrice(data) {
  const { buffer } = data;
  const ipfsHash = await getIPFSHash(buffer);
  const id = await getArIdFromHashes(ipfsHash);
  if (id) {
    return {
      arweaveId: id,
      AR: '0',
    };
  }
  const transaction = await arweave.createTransaction({ data: buffer }, jwk);
  const { reward } = transaction;
  return {
    AR: arweave.ar.winstonToAr(reward),
  };
}

export async function convertARPriceToLIKE(ar, { margin = 0.05, decimal = 0 } = {}) {
  const { data } = await axios.get(COINGECKO_AR_LIKE_PRICE_API);
  const { likecoin, arweave: arweavePrice } = data;
  let priceRatio = new BigNumber(arweavePrice.usd).dividedBy(likecoin.usd);
  // At least 1 LIKE for 1 AR
  priceRatio = BigNumber.max(priceRatio, 1);
  const res = new BigNumber(ar)
    .multipliedBy(priceRatio)
    .multipliedBy(1 + margin)
    .toFixed(decimal, BigNumber.ROUND_UP);
  return res;
}

export async function submitToArweave(data, ipfsHash) {
  const anchorId = (await arweave.api.get('/tx_anchor')).data;
  const { mimetype, buffer } = data;
  const transaction = await arweave.createTransaction({ data: buffer, last_tx: anchorId }, jwk);
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
  const { buffer } = data;
  const ipfsHash = await getIPFSHash(buffer);
  const id = await getArIdFromHashes(ipfsHash);
  if (id) {
    return {
      arweaveId: id,
      ipfsHash,
    };
  }
  const [res] = await Promise.all([
    submitToArweave(data, ipfsHash),
    uploadToIPFS(data.buffer),
  ]);
  return {
    arweaveId: res,
    ipfsHash,
  };
}
