import LRU from 'lru-cache';
import type { DocumentSnapshot } from '@google-cloud/firestore';

import {
  db,
  userCollection,
  likerIdHandleCollection,
  Timestamp,
} from '../../firebase';
import { ONE_DAY_IN_MS } from '../../../constant';
import { checkUserNameValid, normalizeLikerId } from '../../ValidationHelper';
import { ValidationError } from '../../ValidationError';
import type { UserData } from '../../../types/user';

// A handle is bound to one account for good (ADR 0003 Invariant 2), so a hit can
// never go stale and a rename has nothing to invalidate. The TTL only bounds memory.
// Keyed by the handle as written, not lowercased: legacy document ids predate the
// lowercase-only rule and Firestore ids are case-sensitive.
const handleCache = new LRU({ max: 4096, ttl: ONE_DAY_IN_MS });

export function normalizeHandle(handle: string): string {
  return normalizeLikerId(handle).toLowerCase();
}

// Only for tests, which reset the Firestore stub between cases while this
// process-lifetime cache would otherwise carry mappings across them.
export function clearHandleCache(): void {
  handleCache.clear();
}

/**
 * Resolves a public handle — current, renamed-away alias, or internal id — to the
 * account document. Returns undefined when no account answers to it.
 */
export async function resolveUserDocByHandle(
  handleInput: string,
): Promise<DocumentSnapshot<UserData> | undefined> {
  const handle = normalizeLikerId(handleInput || '');
  if (!handle) return undefined;
  const lowered = handle.toLowerCase();

  const cachedId = handleCache.get(handle) as string | undefined;
  if (cachedId) return userCollection.doc(cachedId).get();

  // Document id first: until an account renames, its handle *is* its document id,
  // so the overwhelmingly common case costs the single read it always did. Probed
  // as written before lowercased, because document ids are case-sensitive and
  // legacy ids predate the lowercase-only rule.
  const casings = lowered === handle ? [handle] : [handle, lowered];
  for (const candidate of casings) {
    // eslint-disable-next-line no-await-in-loop
    const selfDoc = await userCollection.doc(candidate).get();
    if (selfDoc.exists) {
      handleCache.set(handle, candidate);
      return selfDoc;
    }
  }

  const indexDoc = await likerIdHandleCollection.doc(lowered).get();
  const { userId } = indexDoc.data() || {};
  if (!userId) return undefined;
  handleCache.set(handle, userId);
  return userCollection.doc(userId).get();
}

export async function resolveUserIdByHandle(
  handleInput: string,
): Promise<string | undefined> {
  return (await resolveUserDocByHandle(handleInput))?.id;
}

/**
 * The internal id an `@handle` attribution string should be stored as. Falls back
 * to the normalized handle when the account cannot be resolved — including on a
 * read failure, since callers record attribution inside best-effort blocks where
 * losing the whole write would cost more than storing a handle (safe under D4).
 */
export async function resolveAttributionUserId(handleInput: string): Promise<string> {
  try {
    const userId = await resolveUserIdByHandle(handleInput);
    if (userId) return userId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to resolve attribution handle ${handleInput}:`, err);
  }
  return normalizeHandle(handleInput);
}

export async function isHandleAvailable(handleInput: string): Promise<boolean> {
  const handle = normalizeHandle(handleInput);
  if (!checkUserNameValid(handle)) return false;
  return !await resolveUserDocByHandle(handle);
}

export function getUserHandle(userId: string, userData?: UserData): string {
  return userData?.handle || userId;
}

/**
 * Whether `requestedId` — a handle, an alias, or an internal id from a route
 * param — names the same account as the internal id in the caller's token. The
 * token always carries the internal id, so the equality fast path covers every
 * request that did not address the user by handle.
 */
export async function isSameUser(
  authenticatedUserId: string,
  requestedId: string,
): Promise<boolean> {
  if (authenticatedUserId === requestedId) return true;
  const userId = await resolveUserIdByHandle(requestedId);
  return !!userId && userId === authenticatedUserId;
}

/**
 * Renames an account's public handle, once per account. The previous handle
 * becomes a permanent alias: it keeps resolving to the same account and can never
 * be claimed by anyone else (ADR 0003 D4), so links and attribution strings
 * already in circulation keep pointing at their owner.
 */
export async function renameUserHandle(
  userId: string,
  newHandleInput: string,
): Promise<{ oldHandle: string; newHandle: string }> {
  const newHandle = normalizeHandle(newHandleInput);
  if (!checkUserNameValid(newHandle)) throw new ValidationError('INVALID_USER_ID');

  const userRef = userCollection.doc(userId);
  const newIndexRef = likerIdHandleCollection.doc(newHandle);
  const newHandleUserRef = userCollection.doc(newHandle);

  const oldHandle = await db.runTransaction(async (t) => {
    const [userDoc, newIndexDoc, newHandleUserDoc] = await Promise.all([
      t.get(userRef),
      t.get(newIndexRef),
      t.get(newHandleUserRef),
    ]);
    const userData = userDoc.data();
    if (!userDoc.exists || !userData || userData.isDeleted) {
      throw new ValidationError('USER_NOT_FOUND', 404);
    }
    const currentHandle = getUserHandle(userId, userData);
    if (userData.handle) throw new ValidationError('HANDLE_ALREADY_CHANGED', 409);
    if (currentHandle === newHandle) throw new ValidationError('HANDLE_UNCHANGED', 400);
    // Claimed by the index, or still held as another account's document id. Both
    // tests are by owner so that reclaiming one's own alias stays possible if the
    // once-per-account rule is ever relaxed.
    const isTaken = (newIndexDoc.exists && newIndexDoc.data()?.userId !== userId)
      || (newHandleUserDoc.exists && newHandleUserDoc.id !== userId);
    if (isTaken) throw new ValidationError('HANDLE_ALREADY_TAKEN', 409);

    const timestamp = Timestamp.now();
    const oldHandleKey = normalizeHandle(currentHandle);
    // Last read of the transaction: Firestore forbids reading after a write.
    const oldIndexDoc = oldHandleKey === newHandle
      ? undefined
      : await t.get(likerIdHandleCollection.doc(oldHandleKey));
    // A legacy mixed-case id can normalize onto a row this account does not own:
    // its own lowercase form, written active just below, or one another account
    // holds. The old casing keeps resolving through its document id either way.
    const canAliasOldHandle = !!oldIndexDoc
      && (!oldIndexDoc.exists || oldIndexDoc.data()?.userId === userId);

    t.set(newIndexRef, { userId, status: 'active', timestamp });
    if (canAliasOldHandle) {
      t.set(
        likerIdHandleCollection.doc(oldHandleKey),
        { userId, status: 'alias', timestamp },
        { merge: true },
      );
    }
    t.update(userRef, { handle: newHandle });
    return currentHandle;
  });

  handleCache.set(newHandle, userId);
  handleCache.set(oldHandle, userId);
  return { oldHandle, newHandle };
}
