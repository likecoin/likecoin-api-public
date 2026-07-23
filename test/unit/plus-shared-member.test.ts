import { describe, it, expect } from 'vitest';
import { SHARED_MEMBER_SEATS, ONE_DAY_IN_MS } from '../../src/constant';
import {
  claimSharedMemberInvite,
  createSharedMemberInvite,
  extendSharedMemberAccess,
  getSharedMembers,
  revokeSharedMemberInvite,
  revokeSharedMemberAccess,
  validateSharedMemberGiver,
} from '../../src/util/api/plus/sharedMember';
import { processRevenueCatEvent } from '../../src/util/api/plus/revenuecat';
import { userCollection } from '../../src/util/firebase';
import type { LikerPlusData, UserCivicLikerProperties } from '../../src/types/user';

const NOW = Date.now();
const PERIOD_START = NOW - ONE_DAY_IN_MS;
const PERIOD_END = NOW + 300 * ONE_DAY_IN_MS;

const FAKE_REQ = { headers: {} } as unknown as Express.Request;

// The firestore stub accumulates docs across tests in a file, so every seeded
// user needs a unique wallet for by-wallet lookups. Digits-only hex addresses
// are checksum-stable.
function walletOf(n: number): string {
  return `0x${String(n).padStart(40, '0')}`;
}

function makeLikerPlus(overrides: Partial<LikerPlusData> = {}): LikerPlusData {
  return {
    period: 'year',
    since: PERIOD_START,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    tier: 'civic',
    subscriptionStatus: 'active',
    subscriptionId: 'sub_test',
    customerId: 'cus_test',
    ...overrides,
  };
}

function makeSharedMemberLikerPlus(
  grantedBy: string,
  overrides: Partial<LikerPlusData> = {},
): LikerPlusData {
  return {
    tier: 'plus',
    currentType: 'shared',
    provider: 'shared',
    grantedBy,
    since: PERIOD_START,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    subscriptionStatus: 'active',
    dailyValue: 0,
    dailyValueCurrency: 'USD',
    ...overrides,
  };
}

function makeGiver(
  overrides: Partial<UserCivicLikerProperties> = {},
): UserCivicLikerProperties {
  return {
    user: 'civicgiver',
    avatar: '',
    isLikerPlus: true,
    isLikerPlusTrial: false,
    likerPlusTier: 'civic',
    likerPlusSubscriptionStatus: 'active',
    likerPlus: makeLikerPlus(),
    ...overrides,
  };
}

async function seedUser(likerId: string, evmWallet: string, likerPlus?: LikerPlusData) {
  const payload: Record<string, unknown> = {
    evmWallet,
    email: `${likerId}@example.com`,
  };
  if (likerPlus) payload.likerPlus = likerPlus;
  await userCollection.doc(likerId).set(payload);
}

async function getInvite(giverLikerId: string, inviteId: string) {
  const doc = await userCollection.doc(giverLikerId)
    .collection('sharedMembers').doc(inviteId).get();
  return doc.data();
}

async function getLikerPlus(likerId: string): Promise<LikerPlusData | undefined> {
  const doc = await userCollection.doc(likerId).get();
  return (doc.data() as { likerPlus?: LikerPlusData } | undefined)?.likerPlus;
}

describe('validateSharedMemberGiver', () => {
  it('accepts an active, non-trial Civic subscriber', () => {
    const giver = makeGiver();
    expect(validateSharedMemberGiver(giver).likerPlus).toEqual(giver.likerPlus);
  });

  it('rejects a missing user', () => {
    expect(() => validateSharedMemberGiver(null)).toThrow('USER_NOT_FOUND');
  });

  it('rejects a Plus-tier (non-Civic) subscriber', () => {
    const giver = makeGiver({
      likerPlusTier: 'plus',
      likerPlus: makeLikerPlus({ tier: 'plus' }),
    });
    expect(() => validateSharedMemberGiver(giver)).toThrow('CIVIC_TIER_REQUIRED');
  });

  it('rejects a non-subscriber', () => {
    const giver = makeGiver({
      isLikerPlus: undefined,
      likerPlusTier: undefined,
      likerPlus: undefined,
    });
    expect(() => validateSharedMemberGiver(giver)).toThrow('CIVIC_TIER_REQUIRED');
  });

  it('rejects a Civic trial', () => {
    const giver = makeGiver({ isLikerPlusTrial: true });
    expect(() => validateSharedMemberGiver(giver)).toThrow('SHARED_MEMBER_NOT_AVAILABLE_ON_TRIAL');
  });

  it('rejects a non-active subscription (e.g. past_due)', () => {
    const giver = makeGiver({ likerPlusSubscriptionStatus: 'past_due' });
    expect(() => validateSharedMemberGiver(giver)).toThrow('CIVIC_SUBSCRIPTION_NOT_ACTIVE');
  });
});

describe('createSharedMemberInvite', () => {
  it('creates a pending invite and consumes one seat', async () => {
    const wallet = '0x1111111111111111111111111111111111111111';
    await seedUser('giverinvite', wallet, makeLikerPlus());
    const result = await createSharedMemberInvite(
      { email: 'friend@example.com', name: 'Friend', message: 'Welcome' },
      { user: { wallet } },
    );
    expect(result.remainingSeats).toBe(SHARED_MEMBER_SEATS - 1);

    const invite = await getInvite('giverinvite', result.inviteId);
    expect(invite?.status).toBe('pending');
    expect(invite?.email).toBe('friend@example.com');
    expect(invite?.name).toBe('Friend');
    expect(invite?.message).toBe('Welcome');
    expect(invite?.token).toHaveLength(64);
  });

  it('rejects a Plus-tier (non-Civic) giver', async () => {
    const wallet = '0x2222222222222222222222222222222222222222';
    await seedUser('plusinviter', wallet, makeLikerPlus({ tier: 'plus' }));
    await expect(createSharedMemberInvite(
      { email: 'friend@example.com' },
      { user: { wallet } },
    )).rejects.toThrow('CIVIC_TIER_REQUIRED');
  });

  it('rejects a Civic trial giver', async () => {
    const wallet = '0x3333333333333333333333333333333333333333';
    await seedUser('trialinviter', wallet, makeLikerPlus({ currentType: 'trial' }));
    await expect(createSharedMemberInvite(
      { email: 'friend@example.com' },
      { user: { wallet } },
    )).rejects.toThrow('SHARED_MEMBER_NOT_AVAILABLE_ON_TRIAL');
  });

  it('rejects a past_due Civic giver', async () => {
    const wallet = '0x4444444444444444444444444444444444444444';
    await seedUser('pastdueinviter', wallet, makeLikerPlus({ subscriptionStatus: 'past_due' }));
    await expect(createSharedMemberInvite(
      { email: 'friend@example.com' },
      { user: { wallet } },
    )).rejects.toThrow('CIVIC_SUBSCRIPTION_NOT_ACTIVE');
  });

  it('rejects a duplicate email while its invite is pending or claimed', async () => {
    const wallet = '0x5555555555555555555555555555555555555555';
    await seedUser('giverdup', wallet, makeLikerPlus());
    const req = { user: { wallet } };
    await createSharedMemberInvite({ email: 'friend@example.com' }, req);
    // Case-insensitive: the same address must not occupy two seats.
    await expect(createSharedMemberInvite(
      { email: 'Friend@Example.com' },
      req,
    )).rejects.toThrow('SHARED_MEMBER_ALREADY_INVITED');
  });

  it('allows re-inviting an email after its invite was revoked', async () => {
    const wallet = '0x6666666666666666666666666666666666666666';
    await seedUser('giverreinvite', wallet, makeLikerPlus());
    const req = { user: { wallet } };
    const first = await createSharedMemberInvite({ email: 'friend@example.com' }, req);
    await revokeSharedMemberInvite({ inviteId: first.inviteId, wallet });
    const second = await createSharedMemberInvite({ email: 'friend@example.com' }, req);
    expect(second.remainingSeats).toBe(SHARED_MEMBER_SEATS - 1);
  });

  it('exhausts seats at SHARED_MEMBER_SEATS, and revoking frees one', async () => {
    const wallet = '0x7777777777777777777777777777777777777777';
    await seedUser('giverseats', wallet, makeLikerPlus());
    const req = { user: { wallet } };
    let lastInviteId = '';
    for (let i = 1; i <= SHARED_MEMBER_SEATS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await createSharedMemberInvite(
        { email: `friend${i}@example.com` },
        req,
      );
      expect(result.remainingSeats).toBe(SHARED_MEMBER_SEATS - i);
      lastInviteId = result.inviteId;
    }
    await expect(createSharedMemberInvite(
      { email: 'onemore@example.com' },
      req,
    )).rejects.toThrow('SHARED_MEMBER_SEATS_EXHAUSTED');

    // Seats are not per-period consumables: revoking an invite frees its seat.
    await revokeSharedMemberInvite({ inviteId: lastInviteId, wallet });
    const result = await createSharedMemberInvite(
      { email: 'onemore@example.com' },
      req,
    );
    expect(result.remainingSeats).toBe(0);
  });
});

describe('getSharedMembers', () => {
  it('rejects a non-Civic user', async () => {
    const wallet = '0x8888888888888888888888888888888888888888';
    await seedUser('plusmembers', wallet, makeLikerPlus({ tier: 'plus' }));
    await expect(getSharedMembers(wallet)).rejects.toThrow('CIVIC_TIER_REQUIRED');
  });

  it('counts pending/claimed seats, excludes revoked, newest first', async () => {
    const wallet = '0x9999999999999999999999999999999999999999';
    await seedUser('givermembers', wallet, makeLikerPlus());
    const req = { user: { wallet } };
    const first = await createSharedMemberInvite({ email: 'a@example.com' }, req);
    const second = await createSharedMemberInvite({ email: 'b@example.com' }, req);
    const third = await createSharedMemberInvite({ email: 'c@example.com' }, req);
    await revokeSharedMemberInvite({ inviteId: third.inviteId, wallet });
    // The stub stores serverTimestamp sentinels; patch in real toMillis values.
    await userCollection.doc('givermembers').collection('sharedMembers')
      .doc(first.inviteId).update({ timestamp: { toMillis: () => 1000 } });
    await userCollection.doc('givermembers').collection('sharedMembers')
      .doc(second.inviteId).update({ timestamp: { toMillis: () => 2000 } });

    const status = await getSharedMembers(wallet);
    expect(status.used).toBe(2);
    expect(status.total).toBe(SHARED_MEMBER_SEATS);
    expect(status.remaining).toBe(SHARED_MEMBER_SEATS - 2);
    expect(status.members).toHaveLength(2);
    expect(status.members[0]).toMatchObject({
      inviteId: second.inviteId,
      email: 'b@example.com',
      status: 'pending',
      timestamp: 2000,
    });
    expect(status.members[1].inviteId).toBe(first.inviteId);
  });
});

describe('claimSharedMemberInvite', () => {
  async function seedGiverWithInvite(giverLikerId: string, giverWallet: string) {
    await seedUser(giverLikerId, giverWallet, makeLikerPlus());
    const { inviteId } = await createSharedMemberInvite(
      { email: 'member@example.com' },
      { user: { wallet: giverWallet } },
    );
    const invite = await getInvite(giverLikerId, inviteId);
    return { inviteId, token: invite?.token as string };
  }

  it('claims a pending invite and grants a shared member Plus record', async () => {
    const memberWallet = walletOf(101);
    const { inviteId, token } = await seedGiverWithInvite('giverclaim', walletOf(100));
    await seedUser('memberclaim', memberWallet);
    const { memberLikerId } = await claimSharedMemberInvite({
      giverLikerId: 'giverclaim',
      inviteId,
      token,
      wallet: memberWallet,
    });
    expect(memberLikerId).toBe('memberclaim');

    const likerPlus = await getLikerPlus('memberclaim');
    expect(likerPlus).toMatchObject({
      tier: 'plus',
      currentType: 'shared',
      provider: 'shared',
      grantedBy: 'giverclaim',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      subscriptionStatus: 'active',
      dailyValue: 0,
    });
    expect(likerPlus?.subscriptionId).toBeUndefined();
    expect(likerPlus?.customerId).toBeUndefined();

    const invite = await getInvite('giverclaim', inviteId);
    expect(invite?.status).toBe('claimed');
    expect(invite?.memberLikerId).toBe('memberclaim');
    expect(invite?.memberWallet).toBe(memberWallet);
  });

  it('rejects a token mismatch', async () => {
    const memberWallet = walletOf(103);
    const { inviteId } = await seedGiverWithInvite('givertoken', walletOf(102));
    await seedUser('membertoken', memberWallet);
    await expect(claimSharedMemberInvite({
      giverLikerId: 'givertoken',
      inviteId,
      token: 'bad-token',
      wallet: memberWallet,
    })).rejects.toThrow('INVALID_CLAIM_TOKEN');
  });

  it('rejects an already-claimed invite', async () => {
    const memberWallet = walletOf(105);
    const { inviteId, token } = await seedGiverWithInvite('giverreclaim', walletOf(104));
    await seedUser('memberreclaim', memberWallet);
    await claimSharedMemberInvite({
      giverLikerId: 'giverreclaim', inviteId, token, wallet: memberWallet,
    });
    const otherWallet = walletOf(106);
    await seedUser('memberother', otherWallet);
    await expect(claimSharedMemberInvite({
      giverLikerId: 'giverreclaim', inviteId, token, wallet: otherWallet,
    })).rejects.toThrow('INVITE_NOT_CLAIMABLE');
  });

  it('rejects a claimant who already has an active subscription', async () => {
    const memberWallet = walletOf(108);
    const { inviteId, token } = await seedGiverWithInvite('giversubbed', walletOf(107));
    await seedUser('membersubbed', memberWallet, makeLikerPlus({ tier: 'plus' }));
    await expect(claimSharedMemberInvite({
      giverLikerId: 'giversubbed', inviteId, token, wallet: memberWallet,
    })).rejects.toThrow('ALREADY_SUBSCRIBED');
  });

  it('allows a claimant whose old subscription record is expired', async () => {
    const memberWallet = walletOf(110);
    const { inviteId, token } = await seedGiverWithInvite('giverexpired', walletOf(109));
    await seedUser('memberexpired', memberWallet, makeLikerPlus({
      tier: 'plus',
      currentPeriodStart: PERIOD_START - 400 * ONE_DAY_IN_MS,
      currentPeriodEnd: PERIOD_START - 100 * ONE_DAY_IN_MS,
      subscriptionStatus: 'canceled',
    }));
    const { memberLikerId } = await claimSharedMemberInvite({
      giverLikerId: 'giverexpired', inviteId, token, wallet: memberWallet,
    });
    expect(memberLikerId).toBe('memberexpired');
    expect((await getLikerPlus('memberexpired'))?.currentType).toBe('shared');
  });

  it('rejects the claim when the giver has lapsed since inviting', async () => {
    const memberWallet = walletOf(112);
    const { inviteId, token } = await seedGiverWithInvite('giverlapsed', walletOf(111));
    await seedUser('memberlapsed', memberWallet);
    await userCollection.doc('giverlapsed').update({
      'likerPlus.currentPeriodEnd': PERIOD_START - ONE_DAY_IN_MS,
    });
    await expect(claimSharedMemberInvite({
      giverLikerId: 'giverlapsed', inviteId, token, wallet: memberWallet,
    })).rejects.toThrow('CIVIC_TIER_REQUIRED');
  });
});

describe('extendSharedMemberAccess / revokeSharedMemberAccess', () => {
  // Seed a giver with one claimed invite per member liker id given.
  async function seedGiverWithClaimedMembers(
    giverLikerId: string,
    giverWallet: string,
    memberLikerIds: string[],
  ) {
    await seedUser(giverLikerId, giverWallet, makeLikerPlus());
    const membersRef = userCollection.doc(giverLikerId).collection('sharedMembers');
    await Promise.all(memberLikerIds.map((memberLikerId, i) => membersRef.doc(`invite-${i}`).set({
      id: `invite-${i}`,
      email: `${memberLikerId}@example.com`,
      token: 'token',
      status: 'claimed',
      memberLikerId,
      timestamp: { toMillis: () => 1000 + i },
    })));
  }

  it('extends only shared-granted records from this giver', async () => {
    await seedGiverWithClaimedMembers('giverextend', walletOf(200), ['memA', 'upgraded', 'foreign']);
    // memA holds this giver's shared grant, lapsed.
    await seedUser('memA', walletOf(201), makeSharedMemberLikerPlus('giverextend', {
      currentPeriodEnd: PERIOD_START,
      subscriptionStatus: 'canceled',
    }));
    // upgraded bought their own paid sub since claiming — must not be touched.
    await seedUser('upgraded', walletOf(202), makeLikerPlus({ tier: 'plus', currentType: 'paid' }));
    // foreign holds a shared grant from a different giver — must not be touched.
    await seedUser('foreign', walletOf(203), makeSharedMemberLikerPlus('someoneelse'));

    const newEnd = PERIOD_END + 365 * ONE_DAY_IN_MS;
    await extendSharedMemberAccess('giverextend', {
      currentPeriodStart: PERIOD_END,
      currentPeriodEnd: newEnd,
    });

    // The lapsed member is resurrected onto the giver's new period.
    expect(await getLikerPlus('memA')).toMatchObject({
      currentPeriodStart: PERIOD_END,
      currentPeriodEnd: newEnd,
      subscriptionStatus: 'active',
      currentType: 'shared',
      grantedBy: 'giverextend',
    });
    expect(await getLikerPlus('upgraded')).toMatchObject({
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      currentType: 'paid',
    });
    expect(await getLikerPlus('foreign')).toMatchObject({
      currentPeriodEnd: PERIOD_END,
      grantedBy: 'someoneelse',
      subscriptionStatus: 'active',
    });
  });

  it('revokes only shared-granted records from this giver, keeping grantedBy', async () => {
    await seedGiverWithClaimedMembers('giverrevoke', walletOf(204), ['memB', 'upgradedB']);
    await seedUser('memB', walletOf(205), makeSharedMemberLikerPlus('giverrevoke'));
    await seedUser('upgradedB', walletOf(206), makeLikerPlus({ tier: 'plus', currentType: 'paid' }));

    await revokeSharedMemberAccess('giverrevoke');

    const memB = await getLikerPlus('memB');
    expect(memB?.subscriptionStatus).toBe('canceled');
    expect(memB?.currentPeriodEnd).toBeLessThanOrEqual(Date.now());
    // currentType/grantedBy survive so a giver resubscribe resurrects the member.
    expect(memB?.currentType).toBe('shared');
    expect(memB?.grantedBy).toBe('giverrevoke');

    expect(await getLikerPlus('upgradedB')).toMatchObject({
      subscriptionStatus: 'active',
      currentPeriodEnd: PERIOD_END,
    });
  });
});

describe('revokeSharedMemberInvite', () => {
  it('rejects an unknown or already-revoked invite', async () => {
    const giverWallet = walletOf(300);
    await seedUser('giverbadrevoke', giverWallet, makeLikerPlus());
    await expect(revokeSharedMemberInvite({
      inviteId: 'nonexistent',
      wallet: giverWallet,
    })).rejects.toThrow('INVITE_NOT_FOUND');

    const { inviteId } = await createSharedMemberInvite(
      { email: 'friend@example.com' },
      { user: { wallet: giverWallet } },
    );
    await revokeSharedMemberInvite({ inviteId, wallet: giverWallet });
    await expect(revokeSharedMemberInvite({
      inviteId,
      wallet: giverWallet,
    })).rejects.toThrow('INVITE_ALREADY_REVOKED');
  });

  it('revokes a claimed member still holding this giver shared grant', async () => {
    const giverWallet = walletOf(301);
    await seedUser('giverrevokeone', giverWallet, makeLikerPlus());
    await seedUser('memC', walletOf(302), makeSharedMemberLikerPlus('giverrevokeone'));
    await userCollection.doc('giverrevokeone').collection('sharedMembers').doc('inv1').set({
      id: 'inv1',
      email: 'memC@example.com',
      token: 'token',
      status: 'claimed',
      memberLikerId: 'memC',
      timestamp: { toMillis: () => 1000 },
    });

    await revokeSharedMemberInvite({ inviteId: 'inv1', wallet: giverWallet });

    const invite = await getInvite('giverrevokeone', 'inv1');
    expect(invite?.status).toBe('revoked');
    const memC = await getLikerPlus('memC');
    expect(memC?.subscriptionStatus).toBe('canceled');
    expect(memC?.currentPeriodEnd).toBeLessThanOrEqual(Date.now());
  });

  it('does not touch a member who has since bought their own subscription', async () => {
    const giverWallet = walletOf(303);
    await seedUser('giverrevoketwo', giverWallet, makeLikerPlus());
    await seedUser('upgradedC', walletOf(304), makeLikerPlus({ tier: 'plus', currentType: 'paid' }));
    await userCollection.doc('giverrevoketwo').collection('sharedMembers').doc('inv2').set({
      id: 'inv2',
      email: 'upgradedC@example.com',
      token: 'token',
      status: 'claimed',
      memberLikerId: 'upgradedC',
      timestamp: { toMillis: () => 1000 },
    });

    await revokeSharedMemberInvite({ inviteId: 'inv2', wallet: giverWallet });

    expect((await getInvite('giverrevoketwo', 'inv2'))?.status).toBe('revoked');
    expect(await getLikerPlus('upgradedC')).toMatchObject({
      subscriptionStatus: 'active',
      currentPeriodEnd: PERIOD_END,
    });
  });
});

describe('RevenueCat shared-granted-record protection', () => {
  // IS_TESTNET is set in test env, so only SANDBOX events are processed —
  // and on testnet they are not quarantined or locked out.
  it('EXPIRATION never mutates a shared-granted record', async () => {
    await seedUser('memrc', walletOf(400), makeSharedMemberLikerPlus('somegiver'));
    await processRevenueCatEvent({
      type: 'EXPIRATION',
      app_user_id: 'memrc',
      product_id: 'rc_plus_monthly',
      environment: 'SANDBOX',
      expiration_at_ms: NOW,
    }, FAKE_REQ);
    expect(await getLikerPlus('memrc')).toMatchObject({
      subscriptionStatus: 'active',
      currentPeriodEnd: PERIOD_END,
      provider: 'shared',
    });
  });

  it('BILLING_ISSUE never mutates a shared-granted record', async () => {
    await seedUser('memrc2', walletOf(401), makeSharedMemberLikerPlus('somegiver'));
    await processRevenueCatEvent({
      type: 'BILLING_ISSUE',
      app_user_id: 'memrc2',
      product_id: 'rc_plus_monthly',
      environment: 'SANDBOX',
    }, FAKE_REQ);
    expect((await getLikerPlus('memrc2'))?.subscriptionStatus).toBe('active');
  });

  it('EXPIRATION still revokes a RevenueCat-owned record (control)', async () => {
    await seedUser('rcowned', walletOf(402), {
      period: 'year',
      since: PERIOD_START,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      tier: 'plus',
      subscriptionStatus: 'active',
      provider: 'revenuecat',
      environment: 'SANDBOX',
    });
    await processRevenueCatEvent({
      type: 'EXPIRATION',
      app_user_id: 'rcowned',
      product_id: 'rc_plus_monthly',
      environment: 'SANDBOX',
      expiration_at_ms: NOW,
    }, FAKE_REQ);
    const likerPlus = await getLikerPlus('rcowned');
    expect(likerPlus?.subscriptionStatus).toBe('canceled');
    expect(likerPlus?.currentPeriodEnd).toBeLessThanOrEqual(NOW);
  });
});
