import {
  beforeEach, describe, expect, it,
} from 'vitest';
import { checksumAddress } from 'viem';

import { setUserVIPPlus, VIP_PLUS_PERIOD_END } from '../../src/util/api/plus/slack';
import { getUserWithCivicLikerProperties } from '../../src/util/api/users';
import { userCollection } from '../../src/util/firebase';

const DAY = 24 * 60 * 60 * 1000;
const WALLET = checksumAddress(`0x${'e1'.repeat(20)}`);

function activeRecord(extra: Record<string, unknown>) {
  const now = Date.now();
  return {
    since: now - 30 * DAY,
    currentPeriodStart: now - DAY,
    currentPeriodEnd: now + 30 * DAY,
    ...extra,
  };
}

const ACTIVE_PLUS = [
  { provider: 'stripe', id: 'psvipstripe', likerPlus: activeRecord({ subscriptionId: 'sub_1', customerId: 'cus_1' }) },
  { provider: 'revenuecat', id: 'psviprc', likerPlus: activeRecord({ provider: 'revenuecat', store: 'APP_STORE' }) },
  { provider: 'shared', id: 'psvipshared', likerPlus: activeRecord({ provider: 'shared', currentType: 'shared', grantedBy: 'giver' }) },
  { provider: 'stripe', id: 'psviptrial', likerPlus: activeRecord({ provider: 'stripe', currentType: 'trial', subscriptionId: 'sub_2' }) },
  { provider: 'vip', id: 'psvipvip', likerPlus: activeRecord({ isVIP: true, currentPeriodEnd: VIP_PLUS_PERIOD_END }) },
];

// The user stub is not reset between tests, so ids are unique to this file
// and every user is re-seeded before each test.
const USERS: [string, Record<string, unknown>][] = [
  ['psvipemail', { email: 'psvipemail@example.com' }],
  ['psvipid', {}],
  ['psvipwallet', { evmWallet: WALLET }],
  ['psvipexpired', {
    likerPlus: {
      since: Date.now() - 400 * DAY,
      currentPeriodStart: Date.now() - 400 * DAY,
      currentPeriodEnd: Date.now() - 35 * DAY,
      subscriptionId: 'sub_old',
      customerId: 'cus_old',
      provider: 'stripe',
      dailyValue: 3,
      subscriptionStatus: 'canceled',
    },
  }],
  ['psvipdeleted', { isDeleted: true }],
  ...ACTIVE_PLUS.map(({ id, likerPlus }): [string, Record<string, unknown>] => [id, { likerPlus }]),
];

async function getLikerPlus(id: string) {
  return (await userCollection.doc(id).get()).data()?.likerPlus;
}

beforeEach(async () => {
  await Promise.all(USERS.map(([id, data]) => (
    userCollection.doc(id).set({ displayName: id, ...data }))));
});

describe('setUserVIPPlus', () => {
  it.each([
    ['email', 'psvipemail@example.com', 'psvipemail'],
    ['liker ID', 'psvipid', 'psvipid'],
    ['EVM wallet', WALLET, 'psvipwallet'],
  ])('grants VIP Plus to a user found by %s', async (_label, query, userId) => {
    const result = await setUserVIPPlus(query);
    expect(result).toEqual({ user: userId, currentPeriodEnd: VIP_PLUS_PERIOD_END });

    const user = await getUserWithCivicLikerProperties(userId);
    expect(user?.isLikerPlus).toBe(true);
    expect(user?.isLikerPlusTrial).toBe(false);
    expect(user?.likerPlusTier).toBe('plus');
    expect(user?.likerPlusProvider).toBeUndefined();
    expect(user?.likerPlusSubscriptionStatus).toBe('active');
  });

  it('overwrites an expired record as a whole map', async () => {
    await setUserVIPPlus('psvipexpired');

    const likerPlus = await getLikerPlus('psvipexpired');
    expect(likerPlus).toEqual({
      isVIP: true,
      since: expect.any(Number),
      currentPeriodStart: likerPlus.since,
      currentPeriodEnd: VIP_PLUS_PERIOD_END,
      tier: 'plus',
      currentType: 'paid',
      subscriptionStatus: 'active',
    });
  });

  it.each(ACTIVE_PLUS)('rejects an active $id ($provider) Plus without writing', async ({ id, likerPlus, provider }) => {
    await expect(setUserVIPPlus(id))
      .rejects.toThrow(`already has Plus (provider: ${provider}`);
    expect(await getLikerPlus(id)).toEqual(likerPlus);
  });

  it.each([
    ['does not exist', 'nobody@example.com'],
    ['is deleted', 'psvipdeleted'],
  ])('rejects a user that %s', async (_label, query) => {
    await expect(setUserVIPPlus(query)).rejects.toThrow('User not found');
  });
});
