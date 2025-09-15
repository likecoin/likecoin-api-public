import { ISCNQueryClient } from '@likecoin/iscn-js';
import { getLikeWalletAddress } from '@likecoin/iscn-js/dist/iscn/addressParsing';
import { getUserWithCivicLikerProperties } from '../api/users/getPublicInfo';
import { COSMOS_RPC_ENDPOINT } from '../../../config/config';

export { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/messages/parsing';

let queryClient: ISCNQueryClient | null = null;

export async function getISCNQueryClient() {
  if (!queryClient) {
    const client = new ISCNQueryClient();
    await client.connect(COSMOS_RPC_ENDPOINT);
    queryClient = client;
  }
  return queryClient;
}

export function getISCNPrefix(input) {
  const res = /^(iscn:\/\/likecoin-chain\/[A-Za-z0-9-_]+)(?:\/([0-9]*))?$/.exec(input);
  if (!res) throw new Error(`Invalid ISCN ID ${input}`);
  const [, prefix] = res;
  return prefix;
}

export async function getLikeWalletAndLikerIdFromId(id) {
  let likeWallet: string | null = null;
  let likerId: string | null = null;

  const res = id.match(/^https:\/\/like\.co\/([a-z0-9_-]{6,20})/);
  if (res) {
    [, likerId] = res;
    const info = await getUserWithCivicLikerProperties(likerId);
    if (info) {
      ({ likeWallet } = info);
    }
  } else {
    likeWallet = getLikeWalletAddress(id);
  }
  return { likeWallet, likerId };
}
