import { describe, it, expect } from 'vitest';
import type { DocumentSnapshot } from '@google-cloud/firestore';

import { formatUserCivicLikerProperies } from '../../src/util/api/users/getPublicInfo';
import {
  LIKER_PLUS_STORES,
  RC_STORE_TO_LIKER_PLUS_STORE,
  UserDataScopedResponseSchema,
} from '../../src/util/api/users/schemas';
import { filterUserDataScoped } from '../../src/util/ValidationHelper';
import { ONE_DAY_IN_MS } from '../../src/constant';
import type { LikerPlusData, LikerPlusStore, UserData } from '../../src/types/user';

const NOW = Date.now();

function makeUserDoc(likerPlus: Partial<LikerPlusData>): DocumentSnapshot<UserData> {
  return {
    id: 'testuser',
    exists: true,
    data: () => ({
      user: 'testuser',
      likerPlus: {
        since: NOW - ONE_DAY_IN_MS,
        currentPeriodStart: NOW - ONE_DAY_IN_MS,
        currentPeriodEnd: NOW + 30 * ONE_DAY_IN_MS,
        period: 'month',
        tier: 'plus',
        ...likerPlus,
      },
    }),
  } as unknown as DocumentSnapshot<UserData>;
}

describe('likerPlusStore (RevenueCat store → public store)', () => {
  const CASES: Array<[string | undefined, LikerPlusStore | undefined]> = [
    ['APP_STORE', 'app_store'],
    ['MAC_APP_STORE', 'app_store'],
    ['PLAY_STORE', 'play_store'],
    ['AMAZON', undefined],
    ['PROMOTIONAL', undefined],
    ['RC_BILLING', undefined],
    [undefined, undefined],
  ];

  CASES.forEach(([store, expected]) => {
    it(`maps store ${store ?? '(absent)'} to ${expected ?? 'undefined'}`, () => {
      const payload = formatUserCivicLikerProperies(
        makeUserDoc({ provider: 'revenuecat', store }),
      );
      expect(payload.likerPlusProvider).toBe('revenuecat');
      expect(payload.likerPlusStore).toBe(expected);
    });
  });

  it('never sets a store for non-RevenueCat providers', () => {
    const stripe = formatUserCivicLikerProperies(
      makeUserDoc({ provider: 'stripe', subscriptionId: 'sub_test', store: 'APP_STORE' }),
    );
    expect(stripe.likerPlusProvider).toBe('stripe');
    expect(stripe.likerPlusStore).toBeUndefined();

    const shared = formatUserCivicLikerProperies(
      makeUserDoc({ provider: 'shared', grantedBy: 'giver', store: 'PLAY_STORE' }),
    );
    expect(shared.likerPlusProvider).toBe('shared');
    expect(shared.likerPlusStore).toBeUndefined();
  });

  it('surfaces the store in the read:plus scoped response', () => {
    const payload = formatUserCivicLikerProperies(
      makeUserDoc({ provider: 'revenuecat', store: 'PLAY_STORE' }),
    );
    const scoped = filterUserDataScoped(payload, ['read:plus']);
    expect(scoped.likerPlusStore).toBe('play_store');
    const result = UserDataScopedResponseSchema.safeParse(scoped);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('omits the store when read:plus is not granted', () => {
    const payload = formatUserCivicLikerProperies(
      makeUserDoc({ provider: 'revenuecat', store: 'APP_STORE' }),
    );
    expect(filterUserDataScoped(payload, []).likerPlusStore).toBeUndefined();
  });

  // Catches a typo'd or newly added mapping value, which the response schema
  // would reject as a 500 rather than surface as a client-readable store. The
  // table above can't cover this — it only knows the keys hardcoded into it.
  it('only maps to values the response schema declares', () => {
    Object.values(RC_STORE_TO_LIKER_PLUS_STORE)
      .filter((value) => value !== undefined)
      .forEach((value) => {
        expect(LIKER_PLUS_STORES).toContain(value);
      });
  });
});
