import {
  NFT_BOOK_FREE_CLASS_IDS,
} from '../../../../../config/config';
import { getNFTClassBalanceOf } from '../../../evm/nft';
import { ValidationError } from '../../../ValidationError';
import { getUserWithCivicLikerPropertiesByWallet } from '../../users';
import { createFreeBookCartForFreeIds } from './cart';

export async function getFreeBooksForUser(evmWallet?: string) {
  if (evmWallet) {
    const balances = await Promise.all(NFT_BOOK_FREE_CLASS_IDS.map(async (classId) => {
      const balance = await getNFTClassBalanceOf(classId, evmWallet);
      return { classId, balance };
    }));
    return balances.filter((item) => !item.balance).map((item) => item.classId);
  }
  return NFT_BOOK_FREE_CLASS_IDS;
}

export async function claimFreeBooks(evmWallet: string, classId?: string) {
  let classIds: string[] = [];
  if (!classId) {
    classIds = await getFreeBooksForUser(evmWallet);
  } else {
    if (!NFT_BOOK_FREE_CLASS_IDS.includes(classId)) {
      throw new ValidationError('classId not free', 402);
    }
    const balance = await getNFTClassBalanceOf(classId, evmWallet);
    if (balance) {
      throw new ValidationError('classId already owned', 429);
    }
    classIds = [classId];
  }
  if (!classIds.length) {
    throw new ValidationError('No free classIds available', 404);
  }
  const user = await getUserWithCivicLikerPropertiesByWallet(evmWallet);
  if (!user) {
    throw new ValidationError('User not found', 404);
  }
  const { email } = user;
  const {
    cartId,
    paymentId,
    claimToken,
  } = await createFreeBookCartForFreeIds({
    evmWallet,
    classIds,
    email,
  });
  return {
    classIds,
    cartId,
    paymentId,
    claimToken,
  };
}
