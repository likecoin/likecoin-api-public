import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';

import { processStripeSubscriptionCancellation } from '../../src/util/api/plus';
import { processRevenueCatEvent } from '../../src/util/api/plus/revenuecat';
import { VIP_PLUS_PERIOD_END } from '../../src/util/api/plus/slack';
import { userCollection } from '../../src/util/firebase';
import type { LikerPlusData } from '../../src/types/user';

const NOW = Date.now();
const FAKE_REQ = { headers: {} } as unknown as Express.Request;

const VIP_PLUS: LikerPlusData = {
  isVIP: true,
  since: NOW,
  currentPeriodStart: NOW,
  currentPeriodEnd: VIP_PLUS_PERIOD_END,
  tier: 'plus',
  currentType: 'paid',
  subscriptionStatus: 'active',
};

// Digits-only hex addresses are checksum-stable for by-wallet lookups.
function walletOf(n: number): string {
  return `0x${String(n).padStart(40, '0')}`;
}

async function seedVIPUser(likerId: string, evmWallet: string) {
  await userCollection.doc(likerId).set({
    evmWallet,
    email: `${likerId}@example.com`,
    likerPlus: VIP_PLUS,
  });
}

async function getLikerPlus(likerId: string) {
  return (await userCollection.doc(likerId).get()).data()?.likerPlus;
}

describe('VIP Plus protection from billing webhooks', () => {
  it('a cancellation of an old Stripe subscription keeps the VIP record', async () => {
    const wallet = walletOf(6771);
    await seedVIPUser('vipstripe', wallet);
    await processStripeSubscriptionCancellation({
      id: 'sub_oldvip',
      status: 'canceled',
      metadata: { evmWallet: wallet },
      customer: 'cus_oldvip',
      items: { data: [] },
    } as unknown as Stripe.Subscription);
    expect(await getLikerPlus('vipstripe')).toEqual(VIP_PLUS);
  });

  // IS_TESTNET is set in test env, so SANDBOX events are neither quarantined nor locked out.
  it.each(['EXPIRATION', 'BILLING_ISSUE'])('RevenueCat %s keeps the VIP record', async (type) => {
    const likerId = `viprc${type.toLowerCase().replace('_', '')}`;
    await seedVIPUser(likerId, walletOf(type === 'EXPIRATION' ? 6772 : 6773));
    await processRevenueCatEvent({
      type,
      app_user_id: likerId,
      product_id: 'rc_plus_monthly',
      environment: 'SANDBOX',
      expiration_at_ms: NOW,
    }, FAKE_REQ);
    expect(await getLikerPlus(likerId)).toEqual(VIP_PLUS);
  });
});
