import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const { captureMock, identifyMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  identifyMock: vi.fn(),
}));

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = captureMock;

    identify = identifyMock;

    // eslint-disable-next-line class-methods-use-this
    shutdown() { return Promise.resolve(); }
  },
}));

// A key must be present or getPostHogClient() short-circuits and never captures.
// From test/unit/ this path resolves to the repo's config/config, unlike setup.ts
// whose shallower path resolves outside the repo (a no-op).
vi.mock('../../config/config', () => ({
  POSTHOG_API_KEY: 'test-key',
  POSTHOG_HOST: 'https://posthog.invalid',
}));

// eslint-disable-next-line import/first
import logPostHogEvents from '../../src/util/posthog';

function lastSetPayload() {
  const [{ properties }] = captureMock.mock.calls[captureMock.mock.calls.length - 1];
  return properties.$set;
}

describe('logPostHogEvents person properties', () => {
  beforeEach(() => {
    captureMock.mockClear();
    identifyMock.mockClear();
  });

  it('writes entitlement props alongside email for a wallet-identified user', () => {
    logPostHogEvents('SubscriptionCancelled', {
      evmWallet: '0xabc',
      email: 'a@b.c',
      set: { is_liker_plus: false, liker_plus_tier: null },
    });
    expect(lastSetPayload()).toEqual({
      email: 'a@b.c',
      is_liker_plus: false,
      liker_plus_tier: null,
    });
  });

  it('writes entitlement props for a legacy likeWallet-only user', () => {
    logPostHogEvents('Subscribe', {
      likeWallet: 'like1abc',
      set: { is_liker_plus: true, liker_plus_tier: 'plus' },
    });
    expect(lastSetPayload()).toEqual({ is_liker_plus: true, liker_plus_tier: 'plus' });
  });

  it('writes entitlement props for a wallet-less user identified by a forwarded id', () => {
    // handleGrant identifies RevenueCat subscribers by the distinct id the native
    // app forwards, and evmWallet is optional there — gating person writes on a
    // wallet silently dropped exactly the subscribers this is meant to keep fresh.
    logPostHogEvents('Subscribe', {
      posthogDistinctId: 'app-distinct-id',
      set: { is_liker_plus: true, liker_plus_tier: 'plus' },
    });
    expect(lastSetPayload()).toEqual({ is_liker_plus: true, liker_plus_tier: 'plus' });
  });

  it('leaves $set undefined when there is nothing to write', () => {
    logPostHogEvents('SubscriptionCancelled', { evmWallet: '0xabc' });
    expect(lastSetPayload()).toBeUndefined();
  });

  it('repeats the person props through identify when the event carries a dedup uuid', () => {
    logPostHogEvents('Subscribe', {
      evmWallet: '0xabc',
      paymentId: 'sub_123',
      set: { is_liker_plus: true, liker_plus_tier: 'plus' },
    });
    expect(identifyMock).toHaveBeenCalledTimes(1);
    expect(identifyMock.mock.calls[0][0]).toEqual({
      distinctId: '0xabc',
      properties: { is_liker_plus: true, liker_plus_tier: 'plus' },
    });
  });

  it('skips identify when no dedup uuid is derived', () => {
    logPostHogEvents('Subscribe', {
      evmWallet: '0xabc',
      set: { is_liker_plus: true, liker_plus_tier: 'plus' },
    });
    expect(identifyMock).not.toHaveBeenCalled();
  });

  it('skips identify when there are no person props to write', () => {
    logPostHogEvents('SubscriptionCancelled', { evmWallet: '0xabc', paymentId: 'sub_123' });
    expect(identifyMock).not.toHaveBeenCalled();
  });
});
