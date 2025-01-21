import { likeNFTBookUserCollection } from '../../firebase';

export async function findLikeWalletByEvmWallet(evmWallet: string) {
  const userQuery = await likeNFTBookUserCollection.where('evmWallet', '==', evmWallet).get();
  if (userQuery.docs.length === 0) {
    return null;
  }
  return userQuery.docs[0].data()?.likeWallet;
}

export default findLikeWalletByEvmWallet;
