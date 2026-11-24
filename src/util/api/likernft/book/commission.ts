import { NFT_BOOK_LIKER_LAND_FEE_RATIO } from '../../../../../config/config';
import { FieldValue, likeNFTBookCollection } from '../../../firebase';

export interface BookCommissionRatios {
  platformCommissionRatio: number;
  channelCommissionRatio: number;
}

export interface BookCommissionQuery {
  classId: string;
  // null resets the listing to unset, which is not 0 0: an unset book keeps the default commission.
  ratios: BookCommissionRatios | null;
}

export interface BookCommissionResult extends BookCommissionQuery {
  className: string;
}

export const getBookCommissionUsage = (command: string) => `${command} commission <classId> (<platformRatio> <channelRatio> | reset)`;

function parseRatio(label: string, text: string): number {
  const ratio = Number(text);
  if (!/^\d*\.?\d+$/.test(text) || ratio > 1) {
    throw new Error(`Invalid ${label}: ${text}. Must be a number from 0 to 1`);
  }
  return ratio;
}

export function parseBookCommissionQuery(params: string[], command: string): BookCommissionQuery {
  const [classId, platformText, channelText, ...rest] = params;
  if (classId && platformText?.toLowerCase() === 'reset' && !channelText) {
    return { classId, ratios: null };
  }
  if (!classId || !platformText || !channelText || rest.length) {
    throw new Error(`Invalid params. Usage: ${getBookCommissionUsage(command)}`);
  }
  const platformCommissionRatio = parseRatio('platformRatio', platformText);
  const channelCommissionRatio = parseRatio('channelRatio', channelText);
  if (platformCommissionRatio + channelCommissionRatio + NFT_BOOK_LIKER_LAND_FEE_RATIO > 1) {
    throw new Error(`platformRatio + channelRatio + ${NFT_BOOK_LIKER_LAND_FEE_RATIO} platform fee must not exceed 1`);
  }
  return { classId, ratios: { platformCommissionRatio, channelCommissionRatio } };
}

export async function setBookCommission({
  classId,
  ratios,
}: BookCommissionQuery): Promise<BookCommissionResult> {
  const bookRef = likeNFTBookCollection.doc(classId);
  const bookDoc = await bookRef.get();
  const bookData = bookDoc.data();
  if (!bookData) {
    throw new Error(`Listing ${classId} not found`);
  }
  await bookRef.update({
    platformCommissionRatio: ratios ? ratios.platformCommissionRatio : FieldValue.delete(),
    channelCommissionRatio: ratios ? ratios.channelCommissionRatio : FieldValue.delete(),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
  return {
    classId,
    className: bookData.name || classId,
    ratios,
  };
}
