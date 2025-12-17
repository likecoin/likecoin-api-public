import { ISCNQueryClient } from '@likecoin/iscn-js';
import { NFT_RPC_ENDPOINT } from '../../../config/config';

let queryClient: ISCNQueryClient | null = null;
export function isLikeNFTClassId(classId: string) {
  return classId.startsWith('likenft1');
}

export async function getNFTQueryClient() {
  if (!queryClient) {
    const client = new ISCNQueryClient();
    await client.connect(NFT_RPC_ENDPOINT);
    queryClient = client;
  }
  return queryClient;
}

export async function getNFTISCNData(iscnId) {
  const client = await getNFTQueryClient();
  const res = await client.queryRecordsById(iscnId);
  if (!res || !res.records || !res.records.length) return {};
  return {
    owner: res.owner,
    data: res.records[0].data,
  };
}

export async function getNFTClassDataById(classId) {
  const client = await getNFTQueryClient();
  const res = await client.queryNFTClass(classId);
  if (!res) return null;
  return res.class;
}
