import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { likeNFTBookUserCollection } from '../../src/util/firebase';
import { getSubscriptionAffiliateReportForWallet } from '../../src/util/api/likernft/book/user';
import { BookUserSubscriptionAffiliateResponseSchema } from '../../src/util/api/likernft/book/schemas';
import { makeTimestampFromMillis as ts } from '../stub/firebase';
import mockEVMAddress from '../api/address';

const WALLET = mockEVMAddress(0x9999);

// Reseed per test: the firebase stub clears these collections before each test.
beforeEach(async () => {
  // Parent docs must exist before their subcollections persist in the firebase stub.
  await likeNFTBookUserCollection.doc(WALLET).set({ wallet: WALLET } as any);
  const payouts = likeNFTBookUserCollection.doc(WALLET).collection('subscriptionAffiliatePayouts');
  // The stub ignores orderBy, so seed in the payoutAt-desc order the query returns.
  await payouts.doc('sub_year').set({
    subscriptionId: 'sub_year',
    transferId: 'tr_2',
    interval: 'year',
    commissionRate: 0.3,
    balanceTxCents: 9900,
    feeCents: 320,
    payoutCents: 2874,
    currency: 'usd',
    invoiceId: 'in_2',
    subscribedAt: ts(1788000000000),
    payoutAt: ts(1788500000000),
  } as any);
  // A partial doc: no subscriptionId, invoiceId, subscribedAt or interval.
  await payouts.doc('sub_partial').set({
    transferId: 'tr_1',
    commissionRate: 0.3,
    balanceTxCents: 999,
    feeCents: 59,
    payoutCents: 282,
    currency: 'usd',
    payoutAt: ts(1788400000000),
  } as any);
});

describe('getSubscriptionAffiliateReportForWallet', () => {
  it('maps payout docs and rolls up the summary', async () => {
    const report = await getSubscriptionAffiliateReportForWallet(WALLET);

    expect(report.payouts[0]).toEqual({
      subscriptionId: 'sub_year',
      transferId: 'tr_2',
      interval: 'year',
      commissionRate: 0.3,
      balanceTxCents: 9900,
      feeCents: 320,
      payoutCents: 2874,
      currency: 'usd',
      invoiceId: 'in_2',
      subscribedAt: 1788000000000,
      payoutAt: 1788500000000,
    });
    expect(report.summary).toEqual({ totalCents: 3156, subscriptionCount: 2 });
  });

  it('fills a partial doc so the response schema still accepts it', async () => {
    const report = await getSubscriptionAffiliateReportForWallet(WALLET);

    expect(report.payouts[1]).toMatchObject({
      subscriptionId: 'sub_partial',
      interval: 'month',
      payoutAt: 1788400000000,
    });
    expect(report.payouts[1].invoiceId).toBeUndefined();
    expect(report.payouts[1].subscribedAt).toBeUndefined();
    const result = BookUserSubscriptionAffiliateResponseSchema.safeParse(report);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('returns an empty report for a wallet with no payouts', async () => {
    const report = await getSubscriptionAffiliateReportForWallet(mockEVMAddress(0));
    expect(report).toEqual({
      payouts: [],
      summary: { totalCents: 0, subscriptionCount: 0 },
    });
  });
});
