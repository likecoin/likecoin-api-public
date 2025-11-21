import Arweave from 'arweave/node';
import BigNumber from 'bignumber.js';
import LRU from 'lru-cache';
import { getEthereumBundlr, getMaticBundlr } from './signer';

const arweaveIdCache = new LRU({ max: 4096, maxAge: 86400000 }); // 1day

const IPFS_KEY = 'IPFS-CID';

const arweaveGraphQL = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
  timeout: 5000,
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

export async function estimateARV2Price(
  fileSize,
  ipfsHash,
  { checkDuplicate = true, margin = 0 } = {},
) {
  if (ipfsHash && checkDuplicate) {
    const id = await getArweaveIdFromHashes(ipfsHash);
    if (id) {
      return {
        arweaveId: id,
        MATIC: '0',
        ETH: '0',
      };
    }
  }
  const [maticBundlr, ethereumBundlr] = await Promise.all([getMaticBundlr(), getEthereumBundlr()]);
  const [maticPriceAtomic, ethereumPriceAtomic]: BigNumber[] = await Promise.all([
    maticBundlr.getPrice(fileSize),
    ethereumBundlr.getPrice(fileSize),
  ]);
  const maticPriceConverted: BigNumber = maticBundlr.utils.fromAtomic(maticPriceAtomic);
  const ethereumPriceConverted: BigNumber = ethereumBundlr.utils.fromAtomic(ethereumPriceAtomic);
  return {
    MATIC: maticPriceConverted.multipliedBy(1 + margin).toFixed(),
    ETH: ethereumPriceConverted.multipliedBy(1 + margin).toFixed(),
  };
}
