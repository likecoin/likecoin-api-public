import { likeNFTBookCollection } from '../../../firebase';
import { BOOK3_HOSTNAME } from '../../../../constant';
import type { NFTBookListingInfo } from '../../../../types/book';

// Unlike `/book list`, this is a single doc read by id,
// so legacy `like`-chain listings resolve here too.
const EVM_CLASS_ID_REGEX = /^0x[a-fA-F0-9]{40}$/;
const LEGACY_CLASS_ID_REGEX = /^likenft1[ac-hj-np-z02-9]+$/;
// The storefront serves a listing at /store/<classId>,
// optionally behind a locale prefix and followed by tracking query params.
const STORE_PATH_REGEX = /\/store\/([^/?#]+)/;

export const BOOK_INFO_USAGE = `<classId|https://${BOOK3_HOSTNAME}/store/<classId>>`;

// Slack wraps URLs in <…> and appends |label when it renders the link text,
// so a pasted book URL never arrives verbatim.
function unwrapSlackLink(raw: string): string {
  const match = raw.match(/^<(.+?)(?:\|.*)?>$/);
  return match ? match[1] : raw;
}

export function parseBookInfoClassId(input?: string): string {
  const raw = unwrapSlackLink((input || '').trim());
  if (!raw) throw new Error(`Missing class ID. Usage: /book info ${BOOK_INFO_USAGE}`);
  const classId = raw.includes('/') ? raw.match(STORE_PATH_REGEX)?.[1] : raw;
  if (!classId || !(EVM_CLASS_ID_REGEX.test(classId) || LEGACY_CLASS_ID_REGEX.test(classId))) {
    throw new Error(`Invalid class ID or book URL: ${raw}. Usage: /book info ${BOOK_INFO_USAGE}`);
  }
  // Book docs are keyed by lowercase class ID, but explorers show checksummed addresses.
  return classId.toLowerCase();
}

export type AdminBookInfo = Partial<NFTBookListingInfo> & { classId: string };

export async function getBookInfoForAdmin(classId: string): Promise<AdminBookInfo> {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (!doc.exists) throw new Error(`Book class \`${classId}\` not found`);
  const data = (doc.data() || {}) as Partial<NFTBookListingInfo>;
  // Older docs predate the denormalized `classId` field; the doc id is authoritative.
  return { ...data, classId: data.classId || doc.id };
}
