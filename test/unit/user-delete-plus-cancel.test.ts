import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import Stripe from 'stripe';

const { mockUpdate, mockRetrieve } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRetrieve: vi.fn(),
}));

vi.mock('../../src/util/stripe', () => ({
  getStripeClient: () => ({
    subscriptions: {
      update: mockUpdate,
      retrieve: mockRetrieve,
    },
  }),
}));

// eslint-disable-next-line import/first
import { userCollection } from '../../src/util/firebase';
// eslint-disable-next-line import/first
import { deleteAllUserData } from '../../src/util/api/users/delete';

const TEST_SUBSCRIPTION_ID = 'sub_unit_test_123';

function makeResourceMissingError() {
  return new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    message: `No such subscription: '${TEST_SUBSCRIPTION_ID}'`,
  });
}

describe('deleteAllUserData: best-effort Plus subscription cancellation', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  // The stub's non-merge set() appends a doc instead of replacing, and get()
  // returns the first match, so each test needs a fresh user id.
  let testUser: string;
  let testCount = 0;

  const seedUser = async (likerPlus?: { subscriptionId: string, provider?: string }) => {
    await userCollection.doc(testUser).set({
      user: testUser,
      ...(likerPlus ? { likerPlus } : {}),
    } as any);
  };

  const cancelErrorLogged = () => errorSpy.mock.calls.some(
    ([message]) => String(message).includes('Failed to cancel Plus subscription'),
  );

  beforeEach(() => {
    testCount += 1;
    testUser = `unit-delete-plus-user-${testCount}`;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cancels an active stripe subscription at period end', async () => {
    await seedUser({ subscriptionId: TEST_SUBSCRIPTION_ID, provider: 'stripe' });
    mockUpdate.mockResolvedValue({});
    await deleteAllUserData(testUser);
    expect(mockUpdate).toHaveBeenCalledWith(TEST_SUBSCRIPTION_ID, {
      cancel_at_period_end: true,
    });
    expect(cancelErrorLogged()).toBe(false);
  });

  it('skips stripe when the user has no subscriptionId', async () => {
    await seedUser(undefined);
    await deleteAllUserData(testUser);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips and warns for non-stripe subscription providers', async () => {
    await seedUser({ subscriptionId: TEST_SUBSCRIPTION_ID, provider: 'revenuecat' });
    await deleteAllUserData(testUser);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(cancelErrorLogged()).toBe(false);
  });

  it('does not log an error when the subscription is missing in stripe', async () => {
    await seedUser({ subscriptionId: TEST_SUBSCRIPTION_ID, provider: 'stripe' });
    mockUpdate.mockRejectedValue(makeResourceMissingError());
    await deleteAllUserData(testUser);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(cancelErrorLogged()).toBe(false);
  });

  it.each(['canceled', 'incomplete_expired'])(
    'does not log an error when update fails and status is already %s',
    async (status) => {
      await seedUser({ subscriptionId: TEST_SUBSCRIPTION_ID, provider: 'stripe' });
      mockUpdate.mockRejectedValue(
        new Error(`A subscription with status ${status} can not be updated.`),
      );
      mockRetrieve.mockResolvedValue({ status });
      await deleteAllUserData(testUser);
      expect(mockRetrieve).toHaveBeenCalledWith(TEST_SUBSCRIPTION_ID);
      expect(cancelErrorLogged()).toBe(false);
    },
  );

  it('logs an error when update fails and the subscription is still active', async () => {
    await seedUser({ subscriptionId: TEST_SUBSCRIPTION_ID, provider: 'stripe' });
    mockUpdate.mockRejectedValue(new Error('stripe is down'));
    mockRetrieve.mockResolvedValue({ status: 'active' });
    await deleteAllUserData(testUser);
    expect(cancelErrorLogged()).toBe(true);
  });

  it('logs an error but does not throw when update and retrieve both fail', async () => {
    await seedUser({ subscriptionId: TEST_SUBSCRIPTION_ID, provider: 'stripe' });
    mockUpdate.mockRejectedValue(new Error('stripe is down'));
    mockRetrieve.mockRejectedValue(new Error('stripe is still down'));
    await expect(deleteAllUserData(testUser)).resolves.not.toThrow();
    expect(cancelErrorLogged()).toBe(true);
  });
});
