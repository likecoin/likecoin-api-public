import { FieldValue, likeNFTBookCollection } from '../../../firebase';

export interface BookAdultOnlyQuery {
  classId: string;
  isAdultOnly: boolean;
}

export interface BookAdultOnlyResult {
  classId: string;
  className: string;
  isAdultOnly: boolean;
}

export const BOOK_ADULT_ONLY_USAGE = '/book adult <classId> <on|off>';

export function parseBookAdultOnlyQuery(params: string[]): BookAdultOnlyQuery {
  const [classId, toggle, ...rest] = params;
  if (!classId || !toggle || rest.length) {
    throw new Error(`Invalid params. Usage: ${BOOK_ADULT_ONLY_USAGE}`);
  }
  const normalizedToggle = toggle.toLowerCase();
  if (normalizedToggle !== 'on' && normalizedToggle !== 'off') {
    throw new Error(`Invalid toggle: ${toggle}. Must be on or off`);
  }
  return { classId, isAdultOnly: normalizedToggle === 'on' };
}

// Restrict-only, like the publisher flow: turning on revokes ad approval,
// turning off leaves it denied until someone runs approve_with_ads again.
export async function setBookAdultOnly({
  classId,
  isAdultOnly,
}: BookAdultOnlyQuery): Promise<BookAdultOnlyResult> {
  const bookRef = likeNFTBookCollection.doc(classId);
  const bookDoc = await bookRef.get();
  if (!bookDoc.exists) {
    throw new Error(`Book class ${classId} not found`);
  }
  await bookRef.update({
    isAdultOnly,
    ...(isAdultOnly ? { isApprovedForAds: false } : {}),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
  return {
    classId,
    className: bookDoc.data()?.name || classId,
    isAdultOnly,
  };
}
