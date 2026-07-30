import { create, IPFSHTTPClient } from 'ipfs-http-client';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../../config/config');

const {
  IPFS_ENDPOINT,
  REPLICA_IPFS_ENDPOINTS = [],
} = config;

const IPFS_TIMEOUT = 30000;

const getInstance = (() => {
  let instances: {
    primary: IPFSHTTPClient;
    replicas: IPFSHTTPClient[];
  } | null = null;
  return () => {
    if (!instances) {
      instances = {
        primary: create({ url: IPFS_ENDPOINT, timeout: IPFS_TIMEOUT }),
        replicas: REPLICA_IPFS_ENDPOINTS.map((url) => create({ url, timeout: IPFS_TIMEOUT })),
      };
    }
    return instances;
  };
})();

// `file.buffer`, or `file.getStream` for payloads too large to hold in memory.
// A factory rather than a stream because every target consumes it once, and a
// stream cannot be added twice — so replicas each get a fresh one.
export async function uploadFileToIPFS(file, { onlyHash = false } = {}) {
  const client = getInstance();
  const content = () => (file.getStream ? file.getStream() : file.buffer);
  if (!onlyHash) {
    // eslint-disable-next-line no-console
    client.replicas.map((c) => c.add(content()).catch((e) => console.error(e)));
  }
  const res = await client.primary.add(content(), { onlyHash });
  return res.cid.toString();
}

export default uploadFileToIPFS;
