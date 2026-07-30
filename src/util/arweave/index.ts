import Arweave from 'arweave/node';
import LRU from 'lru-cache';
import { formatEther } from 'viem';
import { getPrice } from './signer';
import { scaleBigInt } from '../misc';

const arweaveIdCache = new LRU({ max: 4096, ttl: 86400000 }); // 1day

// Tag name the dedup query below matches on. Exported because the server-side
// uploader must write the same tag it is read by — drift silently kills dedup.
export const IPFS_KEY = 'IPFS-CID';

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
    query($ipfsHash: [String!]!) {
      transactions(
        tags: [
          { name: "${IPFS_KEY}", values: $ipfsHash },
        ]
      ) {
        edges {
          node {
            id
          }
        }
      }
    }`,
      variables: { ipfsHash: [ipfsHash] },
    });
    const ids = res?.data?.data?.transactions?.edges ?? [];
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
        ETH: '0',
      };
    }
  }
  const priceAtomic = await getPrice(fileSize);
  // Apply the margin in atomic (wei) space to avoid float precision loss before formatting.
  const priceWithMargin = margin
    ? scaleBigInt(priceAtomic, 1 + margin)
    : priceAtomic;
  return {
    ETH: formatEther(priceWithMargin),
  };
}
