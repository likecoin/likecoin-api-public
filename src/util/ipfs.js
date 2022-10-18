import { create } from 'ipfs-http-client';
import { CarReader } from '@ipld/car';
import { Web3Storage } from 'web3.storage';

const hash = require('ipfs-only-hash');

const config = require('../../config/config');

const {
  IPFS_ENDPOINT,
  REPLICA_IPFS_ENDPOINTS = [],
  WEB3_STORAGE_API_TOKEN,
} = config;

const IPFS_TIMEOUT = 60000;

const getInstance = (() => {
  let instances = null;
  return () => {
    if (!instances) {
      instances = {
        primary: create({ url: IPFS_ENDPOINT, timeout: IPFS_TIMEOUT }),
        replicas: REPLICA_IPFS_ENDPOINTS.map(url => create({ url, timeout: IPFS_TIMEOUT })),
      };
    }
    return instances;
  };
})();

const getWeb3StorageClient = (() => {
  let client = null;
  return () => {
    if (!client && WEB3_STORAGE_API_TOKEN) {
      client = new Web3Storage({ token: WEB3_STORAGE_API_TOKEN });
    }
    return client;
  };
})();

async function uploadCARToIPFSByWeb3Storage(ipfsHttpClient, cid) {
  try {
    const web3StorageClient = getWeb3StorageClient();
    if (web3StorageClient) {
      const car = ipfsHttpClient.dag.export(cid);
      const reader = await CarReader.fromIterable(car);
      await web3StorageClient.putCar(reader);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error();
  }
}

export async function uploadFileToIPFS(file, { onlyHash = false } = {}) {
  const client = getInstance();
  const fileBlob = file.buffer;
  if (!onlyHash) {
    // eslint-disable-next-line no-console
    client.replicas.map(c => c.add(fileBlob).catch(e => console.error(e)));
  }
  const res = await client.primary.add(fileBlob, { onlyHash });
  await uploadCARToIPFSByWeb3Storage(client.primary, res.cid);
  return res.cid.toString();
}

async function internalUploadAll(client, files, { directoryName = 'tmp', onlyHash = false } = {}) {
  const promises = client.addAll(
    files.map(f => ({
      content: f.buffer,
      path: `/${directoryName}/${f.key}`,
    })), { onlyHash },
  );
  const results = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const result of promises) {
    await uploadCARToIPFSByWeb3Storage(client, result.cid);
    results.push(result);
  }
  return results;
}

export async function uploadFilesToIPFS(files, { onlyHash = false } = {}) {
  if (files.length === 1) return uploadFileToIPFS(files[0]);
  const client = getInstance();
  const directoryName = 'tmp';
  if (!onlyHash) {
    client.replicas.map(
      // eslint-disable-next-line no-console
      c => internalUploadAll(c, files, { directoryName, onlyHash }).catch(e => console.error(e)),
    );
  }
  const results = await internalUploadAll(client.primary, files, { directoryName, onlyHash });
  let entry = results.find(r => r.path === directoryName);
  if (!entry) {
    entry = results.find((r => r.path.endsWith('index.html')));
  }
  if (!entry) return '';
  const contentHash = entry.cid.toString();
  return contentHash;
}

export async function getFileIPFSHash(file) {
  const ipfsHash = await hash.of(file.buffer);
  return ipfsHash;
}

export async function getFolderIPFSHash(files) {
  const dagHash = await uploadFilesToIPFS(files, { onlyHash: true });
  return dagHash;
}

export function getIPFSHash(files) {
  if (files.length === 1) return getFileIPFSHash(files[0]);
  return getFolderIPFSHash(files);
}
