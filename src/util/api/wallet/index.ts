import { isValidLikeAddress } from '../../cosmos';
import { likeNFTBookUserCollection } from '../../firebase';

export async function findLikeWalletByEvmWallet(evmWallet: string) {
  const userQuery = await likeNFTBookUserCollection.where('evmWallet', '==', evmWallet).get();
  if (userQuery.docs.length === 0) {
    return null;
  }
  const docId = userQuery.docs[0].id;
  if (isValidLikeAddress(docId)) {
    return docId;
  }
  return null;
}

export default findLikeWalletByEvmWallet;
