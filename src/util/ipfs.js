import { create } from 'ipfs-http-client';

const hash = require('ipfs-only-hash');

const { IPFS_ENDPOINT } = require('../../config/config');

const getInstance = (() => {
  let instance = null;
  return () => {
    if (!instance) {
      instance = create({ url: IPFS_ENDPOINT });
    }
    return instance;
  };
})();

export async function uploadToIPFS(fileBlob) {
  const client = getInstance();
  const res = await client.add(fileBlob);
  return res;
}

export async function getIPFSHash(fileBlob) {
  const ipfsHash = await hash.of(fileBlob);
  return ipfsHash;
}
