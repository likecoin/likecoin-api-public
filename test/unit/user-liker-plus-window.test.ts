import { describe, it, expect } from 'vitest';
import type { DocumentSnapshot } from '@google-cloud/firestore';

import { formatUserCivicLikerProperies } from '../../src/util/api/users/getPublicInfo';
import {
  ONE_DAY_IN_MS,
  ONE_MINUTE_IN_MS,
  RENEWAL_LEAD_TOLERANCE,
  SUBSCRIPTION_GRACE_PERIOD,
} from '../../src/constant';
import type { LikerPlusData, UserData } from '../../src/types/user';

const NOW = Date.now();

function makeUserDoc(likerPlus: Partial<LikerPlusData>): DocumentSnapshot<UserData> {
  return {
    id: 'testuser',
    exists: true,
    data: () => ({
      user: 'testuser',
      likerPlus: {
        since: NOW - 30 * ONE_DAY_IN_MS,
        currentPeriodStart: NOW - ONE_DAY_IN_MS,
        currentPeriodEnd: NOW + 30 * ONE_DAY_IN_MS,
        period: 'month',
        tier: 'plus',
        provider: 'revenuecat',
        store: 'APP_STORE',
        ...likerPlus,
      },
    }),
  } as unknown as DocumentSnapshot<UserData>;
}

describe('likerPlus access window', () => {
  it('grants access inside the period', () => {
    const payload = formatUserCivicLikerProperies(makeUserDoc({}));
    expect(payload.isLikerPlus).toBe(true);
    expect(payload.isExpiredLikerPlus).toBeUndefined();
  });

  // Regression: an App Store renewal webhook lands before the period it
  // describes, and its whole-object write drops the still-valid prior period.
  it('grants access when a store renewal starts in the near future', () => {
    const payload = formatUserCivicLikerProperies(makeUserDoc({
      since: NOW - 31 * ONE_DAY_IN_MS,
      currentPeriodStart: NOW + 60 * ONE_MINUTE_IN_MS,
      currentPeriodEnd: NOW + 31 * ONE_DAY_IN_MS,
    }));
    expect(payload.isLikerPlus).toBe(true);
    expect(payload.isExpiredLikerPlus).toBeUndefined();
    expect(payload.likerPlusTier).toBe('plus');
    expect(payload.likerPlusSubscriptionStatus).toBe('active');
  });

  it('grants access at the far edge of the renewal lead tolerance', () => {
    const payload = formatUserCivicLikerProperies(makeUserDoc({
      currentPeriodStart: NOW + RENEWAL_LEAD_TOLERANCE - ONE_MINUTE_IN_MS,
      currentPeriodEnd: NOW + 60 * ONE_DAY_IN_MS,
    }));
    expect(payload.isLikerPlus).toBe(true);
  });

  // Beyond the lead tolerance the record is neither live nor expired: it
  // describes a period that has not begun, so no flag is set either way.
  it('withholds access beyond the renewal lead tolerance', () => {
    const payload = formatUserCivicLikerProperies(makeUserDoc({
      currentPeriodStart: NOW + RENEWAL_LEAD_TOLERANCE + ONE_DAY_IN_MS,
      currentPeriodEnd: NOW + 60 * ONE_DAY_IN_MS,
    }));
    expect(payload.isLikerPlus).toBeUndefined();
    expect(payload.isExpiredLikerPlus).toBeUndefined();
  });

  it('marks an ended period expired regardless of the lead tolerance', () => {
    const payload = formatUserCivicLikerProperies(makeUserDoc({
      currentPeriodStart: NOW - 60 * ONE_DAY_IN_MS,
      currentPeriodEnd: NOW - ONE_DAY_IN_MS - SUBSCRIPTION_GRACE_PERIOD,
    }));
    expect(payload.isLikerPlus).toBeUndefined();
    expect(payload.isExpiredLikerPlus).toBe(true);
    expect(payload.likerPlusSubscriptionStatus).toBe('canceled');
  });
});
