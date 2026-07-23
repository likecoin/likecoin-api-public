import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { SHARED_MEMBER_SEATS } from '../../../constant';
import { FieldValue, db, userCollection } from '../../firebase';
import { ValidationError } from '../../ValidationError';
import { constantTimeEqual } from '../../misc';
import { sendSharedMemberInviteEmail } from '../../ses';
import { updateIntercomUserAttributes, sendIntercomEvent } from '../../intercom';
import { getBookUserInfoFromWallet } from '../likernft/book/user';
import {
  getUserWithCivicLikerProperties,
  getUserWithCivicLikerPropertiesByWallet,
} from '../users/getPublicInfo';
import type {
  LikerPlusData,
  SharedMemberActiveStatus,
  SharedMemberInviteData,
  UserCivicLikerProperties,
  UserData,
} from '../../../types/user';

// Shared membership (Model B): a Civic-tier subscriber holds SHARED_MEMBER_SEATS
// revocable seats. A seat is occupied by a 'pending' or 'claimed' invite;
// revoking frees it. A claimed member's likerPlus record mirrors the giver's
// current period and follows the giver's subscription lifecycle: renewals
// extend it (extendSharedMemberAccess) and cancellation/expiration/downgrade
// revoke it (revokeSharedMemberAccess).
const ACTIVE_INVITE_STATUSES: SharedMemberActiveStatus[] = ['pending', 'claimed'];

function getSharedMembersRef(giverLikerId: string) {
  return userCollection.doc(giverLikerId).collection('sharedMembers');
}

// A shared-membership giver must hold an active, non-trial Civic-tier subscription.
// Throws ValidationError otherwise; returns the giver with likerPlus narrowed.
// Error-code convention: CIVIC_* asserts something about the giver's own
// subscription, SHARED_MEMBER_* about the seats/invites layered on top of it.
export function validateSharedMemberGiver(
  giver: UserCivicLikerProperties | null,
): UserCivicLikerProperties & { likerPlus: LikerPlusData } {
  if (!giver) {
    throw new ValidationError('USER_NOT_FOUND', 404);
  }
  const { likerPlus } = giver;
  if (!likerPlus || !giver.isLikerPlus || giver.likerPlusTier !== 'civic') {
    throw new ValidationError('CIVIC_TIER_REQUIRED', 403);
  }
  if (giver.isLikerPlusTrial) {
    throw new ValidationError('SHARED_MEMBER_NOT_AVAILABLE_ON_TRIAL', 403);
  }
  if (giver.likerPlusSubscriptionStatus !== 'active') {
    throw new ValidationError('CIVIC_SUBSCRIPTION_NOT_ACTIVE', 403);
  }
  return { ...giver, likerPlus };
}

export async function createSharedMemberInvite(
  { email, name, message }: { email: string; name?: string; message?: string },
  req,
): Promise<{ inviteId: string; remainingSeats: number }> {
  const { wallet } = req.user;
  const giver = validateSharedMemberGiver(
    await getUserWithCivicLikerPropertiesByWallet(wallet),
  );
  const giverLikerId = giver.user;
  const inviteId = uuidv4();
  const token = crypto.randomBytes(32).toString('hex');
  const membersRef = getSharedMembersRef(giverLikerId);
  // Race-safe seat check: the transaction re-reads the active (pending +
  // claimed) invites, so concurrent invites cannot exceed SHARED_MEMBER_SEATS.
  const remainingSeats: number = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(
      membersRef.where('status', 'in', ACTIVE_INVITE_STATUSES),
    );
    const normalizedEmail = email.toLowerCase();
    const hasActiveInviteForEmail = snapshot.docs.some(
      (doc) => (doc.data().email || '').toLowerCase() === normalizedEmail,
    );
    if (hasActiveInviteForEmail) {
      throw new ValidationError('SHARED_MEMBER_ALREADY_INVITED', 409);
    }
    if (snapshot.docs.length >= SHARED_MEMBER_SEATS) {
      throw new ValidationError('SHARED_MEMBER_SEATS_EXHAUSTED', 429);
    }
    const payload: Record<string, unknown> = {
      id: inviteId,
      email,
      token,
      status: 'pending',
      timestamp: FieldValue.serverTimestamp(),
    };
    if (name) payload.name = name;
    if (message) payload.message = message;
    transaction.create(membersRef.doc(inviteId), payload);
    return SHARED_MEMBER_SEATS - snapshot.docs.length - 1;
  });

  await sendSharedMemberInviteEmail({
    fromName: giver.displayName || giverLikerId,
    fromEmail: giver.email || '',
    toName: name || '',
    toEmail: email,
    message: message || '',
    giverLikerId,
    inviteId,
    token,
    language: giver.locale || 'zh',
  });

  return { inviteId, remainingSeats };
}

// Deliberately a weaker check than validateSharedMemberGiver: a lapsed, trialing
// or past_due giver can still list their seats (and so revoke one), just not invite.
export async function getSharedMembers(wallet: string) {
  const giver = await getUserWithCivicLikerPropertiesByWallet(wallet);
  if (!giver?.likerPlus || giver.likerPlusTier !== 'civic') {
    throw new ValidationError('CIVIC_TIER_REQUIRED', 403);
  }
  const snapshot = await getSharedMembersRef(giver.user)
    .where('status', 'in', ACTIVE_INVITE_STATUSES)
    .get();
  const members = snapshot.docs
    .map((doc) => {
      const data = doc.data() as SharedMemberInviteData;
      return {
        inviteId: doc.id,
        email: data.email,
        name: data.name,
        // The query filters on ACTIVE_INVITE_STATUSES, so 'revoked' is excluded.
        status: data.status as SharedMemberActiveStatus,
        timestamp: data.timestamp?.toMillis(),
        claimTimestamp: data.claimTimestamp?.toMillis(),
      };
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return {
    used: members.length,
    total: SHARED_MEMBER_SEATS,
    remaining: Math.max(0, SHARED_MEMBER_SEATS - members.length),
    members,
  };
}

// Claim a member-seat invite. The giver is addressed explicitly (giverLikerId
// from the invite email's claim URL context) so the invite is a direct doc
// lookup — no collection-group query/index on token is needed.
export async function claimSharedMemberInvite({
  giverLikerId,
  inviteId,
  token,
  wallet,
}: {
  giverLikerId: string;
  inviteId: string;
  token: string;
  wallet: string;
}): Promise<{ memberLikerId: string }> {
  const userInfo = await getBookUserInfoFromWallet(wallet);
  const likerUserInfo = userInfo?.likerUserInfo;
  if (!likerUserInfo) {
    throw new ValidationError('USER_NOT_FOUND', 404);
  }
  // isLikerPlus is period-gated (see getPublicInfo), so an expired record does
  // not block the claim — mirrors the paid gift-claim guard.
  if (likerUserInfo.isLikerPlus) {
    throw new ValidationError('ALREADY_SUBSCRIBED', 409);
  }
  const memberLikerId = likerUserInfo.user;

  // The giver must still hold an active, non-trial Civic sub at claim time.
  const giver = validateSharedMemberGiver(
    await getUserWithCivicLikerProperties(giverLikerId),
  );

  const inviteRef = getSharedMembersRef(giverLikerId).doc(inviteId);
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const inviteDoc = await transaction.get(inviteRef);
    const invite = inviteDoc.data();
    if (!invite) {
      throw new ValidationError('INVITE_NOT_FOUND', 404);
    }
    if (!token || !invite.token || !constantTimeEqual(token, invite.token)) {
      throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
    }
    if (invite.status !== 'pending') {
      throw new ValidationError('INVITE_NOT_CLAIMABLE', 409);
    }
    // Shared grant: mirrors the giver's current period. No Stripe/RevenueCat
    // objects, and dailyValue 0 — shared members do not fund the rev-share pool.
    transaction.update(userCollection.doc(memberLikerId), {
      likerPlus: {
        tier: 'plus',
        currentType: 'shared',
        provider: 'shared',
        grantedBy: giverLikerId,
        since: now,
        currentPeriodStart: giver.likerPlus.currentPeriodStart,
        currentPeriodEnd: giver.likerPlus.currentPeriodEnd,
        subscriptionStatus: 'active',
        dailyValue: 0,
        dailyValueCurrency: 'USD',
      },
    });
    transaction.update(inviteRef, {
      status: 'claimed',
      memberLikerId,
      memberWallet: wallet,
      claimTimestamp: FieldValue.serverTimestamp(),
    });
  });

  await Promise.all([
    updateIntercomUserAttributes(memberLikerId, {
      is_liker_plus: true,
      is_liker_plus_trial: false,
      liker_plus_tier: 'plus',
    }),
    sendIntercomEvent({
      userId: memberLikerId,
      eventName: 'plus_subscription_start',
    }),
  ]);

  return { memberLikerId };
}

// Whether this record is owned by some giver's shared-membership lifecycle.
// `provider` says which billing system owns the record; `currentType` sits
// alongside 'trial'/'paid'/'gift'. Both use 'shared' — see isSharedGrantFrom
// for why the giver-scoped check reads currentType rather than provider.
export function isSharedGrantedLikerPlus(likerPlus?: LikerPlusData): boolean {
  return likerPlus?.provider === 'shared';
}

// Whether this record is the shared grant issued by `giverLikerId`. A member
// who has since bought their own subscription no longer matches (their paid
// record overwrote the shared grant) and must never be touched.
function isSharedGrantFrom(
  likerPlus: LikerPlusData | undefined,
  giverLikerId: string,
): boolean {
  return likerPlus?.currentType === 'shared' && likerPlus?.grantedBy === giverLikerId;
}

// Atomically apply `fields` to the member's likerPlus, but only while the record
// is still this giver's shared grant. The check and write share one transaction so
// a member who buys their own sub between read and write can't have that paid
// record clobbered. Returns whether the update was applied.
async function updateSharedGrantIfOwned(
  memberLikerId: string,
  giverLikerId: string,
  fields: { [field: string]: string | number },
): Promise<boolean> {
  const memberRef = userCollection.doc(memberLikerId);
  return db.runTransaction(async (transaction) => {
    const memberDoc = await transaction.get(memberRef);
    const likerPlus = (memberDoc.data() as UserData | undefined)?.likerPlus;
    if (!isSharedGrantFrom(likerPlus, giverLikerId)) return false;
    transaction.update(memberRef, fields);
    return true;
  });
}

async function revokeSharedMemberRecord(giverLikerId: string, memberLikerId: string) {
  // Keep currentType 'shared' and grantedBy: a lapsed giver's members retain
  // them with a past currentPeriodEnd, so a later Civic resubscribe/renewal by
  // the same giver resurrects exactly those members via extend. Intentional.
  const didRevoke = await updateSharedGrantIfOwned(memberLikerId, giverLikerId, {
    'likerPlus.currentPeriodEnd': Date.now(),
    'likerPlus.subscriptionStatus': 'canceled',
  });
  if (!didRevoke) return;
  // Best-effort CRM cleanup — must not fail the caller (webhook or API response).
  try {
    await updateIntercomUserAttributes(memberLikerId, {
      is_liker_plus: false,
      is_liker_plus_trial: false,
      liker_plus_tier: '',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

async function extendSharedMemberRecord(
  giverLikerId: string,
  memberLikerId: string,
  { currentPeriodStart, currentPeriodEnd }: {
    currentPeriodStart: number;
    currentPeriodEnd: number;
  },
) {
  const didExtend = await updateSharedGrantIfOwned(memberLikerId, giverLikerId, {
    'likerPlus.currentPeriodStart': currentPeriodStart,
    'likerPlus.currentPeriodEnd': currentPeriodEnd,
    'likerPlus.subscriptionStatus': 'active',
  });
  if (!didExtend) return;
  // Re-assert the member's Plus flags: a lapsed-then-renewed giver resurrects
  // members whose flags were cleared on revoke. Best-effort like the clear.
  try {
    await updateIntercomUserAttributes(memberLikerId, {
      is_liker_plus: true,
      is_liker_plus_trial: false,
      liker_plus_tier: 'plus',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

// Apply `fn` to each claimed member, best-effort per member: one
// member's failure must not fail the giver's webhook or skip the others.
async function forEachClaimedSharedMember(
  giverLikerId: string,
  fn: (memberLikerId: string) => Promise<void>,
) {
  const snapshot = await getSharedMembersRef(giverLikerId)
    .where('status', '==', 'claimed')
    .get();
  await Promise.all(snapshot.docs.map(async (doc) => {
    const { memberLikerId } = doc.data();
    if (!memberLikerId) return;
    try {
      await fn(memberLikerId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Error updating shared member ${memberLikerId} of ${giverLikerId}:`, err);
    }
  }));
}

// Carry claimed members along with the giver's new billing period (invoice
// paid / RC grant). Never throws — member propagation must not fail a webhook.
export async function extendSharedMemberAccess(
  giverLikerId: string,
  period: { currentPeriodStart: number; currentPeriodEnd: number },
): Promise<void> {
  try {
    await forEachClaimedSharedMember(
      giverLikerId,
      (memberLikerId) => extendSharedMemberRecord(giverLikerId, memberLikerId, period),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Error extending shared members of ${giverLikerId}:`, err);
  }
}

// Revoke claimed members' access when the giver's Civic sub ends or downgrades
// to Plus. Never throws — member propagation must not fail a webhook.
export async function revokeSharedMemberAccess(giverLikerId: string): Promise<void> {
  try {
    await forEachClaimedSharedMember(
      giverLikerId,
      (memberLikerId) => revokeSharedMemberRecord(giverLikerId, memberLikerId),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Error revoking shared members of ${giverLikerId}:`, err);
  }
}

// Revoke a giver-owned invite, freeing its seat. If the invite was claimed,
// the member's access is revoked too — but only while their record is still
// the shared grant from this giver (a self-bought sub is never touched).
export async function revokeSharedMemberInvite({
  inviteId,
  wallet,
}: {
  inviteId: string;
  wallet: string;
}): Promise<{ memberLikerId?: string }> {
  const giver = await getUserWithCivicLikerPropertiesByWallet(wallet);
  if (!giver) {
    throw new ValidationError('USER_NOT_FOUND', 404);
  }
  const giverLikerId = giver.user;
  const inviteRef = getSharedMembersRef(giverLikerId).doc(inviteId);
  const inviteDoc = await inviteRef.get();
  const invite = inviteDoc.data();
  if (!invite) {
    throw new ValidationError('INVITE_NOT_FOUND', 404);
  }
  if (invite.status === 'revoked') {
    throw new ValidationError('INVITE_ALREADY_REVOKED', 409);
  }
  const { status, memberLikerId } = invite;
  await inviteRef.update({
    status: 'revoked',
    revokeTimestamp: FieldValue.serverTimestamp(),
  });
  if (status === 'claimed' && memberLikerId) {
    await revokeSharedMemberRecord(giverLikerId, memberLikerId);
  }
  return { memberLikerId };
}
