import {
  beforeAll, beforeEach, describe, expect, it,
} from 'vitest';
import { checksumAddress } from 'viem';

import { listPlusAffiliates, setUserPlusAffiliate } from '../../src/util/api/plus/slack';
import { formatPlusAffiliateListSlackText } from '../../src/util/slack';
import {
  likeNFTBookUserCollection,
  likerIdHandleCollection,
  userCollection,
} from '../../src/util/firebase';

function walletOf(seed: string) {
  return checksumAddress(`0x${seed.repeat(20)}`);
}

// The user stub is not reset between tests, so these are seeded once
// under ids unique to this file.
const AFFILIATE_ACTIVE = { id: 'psaffactive', wallet: walletOf('a1') };
const AFFILIATE_INACTIVE = { id: 'psaffinactive', wallet: walletOf('a2') };
const AFFILIATE_NO_CONFIG = { id: 'psaffnoconfig', wallet: walletOf('a3') };
const TARGET_BY_EMAIL = { id: 'psafftargetemail', email: 'psafftargetemail@example.com' };
const TARGET_BY_ID = { id: 'psafftargetid' };
const TARGET_BY_WALLET = { id: 'psafftargetwallet', wallet: walletOf('d1') };
const TARGET_UNCHANGED = { id: 'psafftargetkeep' };

async function seedUser(id: string, data: Record<string, unknown>) {
  await userCollection.doc(id).set({ displayName: id, ...data });
}

async function seedAffiliateConfig(wallet: string, active: boolean, voiceCount = 0) {
  await likeNFTBookUserCollection.doc(wallet).set({
    affiliateConfig: {
      active,
      affiliateClassIds: [],
      giftOnTrial: false,
      customVoices: Array.from({ length: voiceCount }, (_, i) => ({
        id: `voice-${i}`,
        name: `Voice ${i}`,
        language: 'zh-HK',
      })),
    },
  });
}

beforeAll(async () => {
  await seedUser(AFFILIATE_ACTIVE.id, {
    evmWallet: AFFILIATE_ACTIVE.wallet,
    displayName: 'Active Affiliate',
  });
  await seedUser(AFFILIATE_INACTIVE.id, { evmWallet: AFFILIATE_INACTIVE.wallet });
  await seedUser(AFFILIATE_NO_CONFIG.id, { evmWallet: AFFILIATE_NO_CONFIG.wallet });
  await seedUser(TARGET_BY_EMAIL.id, {
    email: TARGET_BY_EMAIL.email,
    plusAffiliateFrom: 'oldaffiliate',
  });
  await seedUser(TARGET_BY_ID.id, {});
  await seedUser(TARGET_BY_WALLET.id, { evmWallet: TARGET_BY_WALLET.wallet });
  await seedUser(TARGET_UNCHANGED.id, { plusAffiliateFrom: 'oldaffiliate' });
});

async function getPlusAffiliateFrom(userId: string) {
  return (await userCollection.doc(userId).get()).data()?.plusAffiliateFrom;
}

describe('listPlusAffiliates', () => {
  it('lists only active configs, skipping inactive ones and book users without one', async () => {
    await seedAffiliateConfig(AFFILIATE_INACTIVE.wallet, false);
    await seedAffiliateConfig(AFFILIATE_ACTIVE.wallet, true, 2);
    await likeNFTBookUserCollection.doc(walletOf('b1')).set({ isStripeConnectReady: true });

    expect(await listPlusAffiliates()).toEqual([{
      wallet: AFFILIATE_ACTIVE.wallet,
      user: AFFILIATE_ACTIVE.id,
      displayName: 'Active Affiliate',
      customVoiceCount: 2,
    }]);
  });

  it('keeps a config whose wallet has no liker user', async () => {
    const orphanWallet = walletOf('c1');
    await seedAffiliateConfig(orphanWallet, true, 1);

    const entries = await listPlusAffiliates();
    expect(entries).toEqual([{
      wallet: orphanWallet,
      user: undefined,
      displayName: undefined,
      customVoiceCount: 1,
    }]);
    expect(formatPlusAffiliateListSlackText(entries)).toContain(orphanWallet);
  });
});

describe('formatPlusAffiliateListSlackText', () => {
  it('renders one line per affiliate with its voice count', () => {
    const text = formatPlusAffiliateListSlackText([
      {
        wallet: AFFILIATE_ACTIVE.wallet,
        user: AFFILIATE_ACTIVE.id,
        displayName: 'Karen',
        customVoiceCount: 3,
      },
      {
        wallet: AFFILIATE_INACTIVE.wallet,
        user: AFFILIATE_INACTIVE.id,
        customVoiceCount: 0,
      },
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toContain('2 active affiliate(s)');
    expect(lines[1]).toContain(AFFILIATE_ACTIVE.id);
    expect(lines[1]).toContain('Karen');
    expect(lines[1]).toContain('3 voice(s)');
    expect(lines[2]).toContain(AFFILIATE_INACTIVE.id);
    expect(lines[2]).toContain('0 voice(s)');
  });

  it('escapes mrkdwn in display names', () => {
    const text = formatPlusAffiliateListSlackText([{
      wallet: AFFILIATE_ACTIVE.wallet,
      user: AFFILIATE_ACTIVE.id,
      displayName: '<!channel>',
      customVoiceCount: 0,
    }]);
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('&lt;!channel&gt;');
  });

  it('says so when there are no active affiliates', () => {
    expect(formatPlusAffiliateListSlackText([])).toBe('No active affiliates found');
  });
});

describe('setUserPlusAffiliate', () => {
  beforeEach(async () => {
    await seedAffiliateConfig(AFFILIATE_ACTIVE.wallet, true, 2);
    await seedAffiliateConfig(AFFILIATE_INACTIVE.wallet, false, 1);
    await likerIdHandleCollection.doc('psaffrenamed').set({ userId: AFFILIATE_ACTIVE.id });
  });

  it('stores the affiliate internal id and reports the change', async () => {
    const result = await setUserPlusAffiliate(TARGET_BY_EMAIL.email, AFFILIATE_ACTIVE.id);

    expect(result).toEqual({
      user: TARGET_BY_EMAIL.id,
      previousPlusAffiliateFrom: 'oldaffiliate',
      plusAffiliateFrom: AFFILIATE_ACTIVE.id,
      customVoices: [
        { name: 'Voice 0', language: 'zh-HK' },
        { name: 'Voice 1', language: 'zh-HK' },
      ],
    });
    expect(await getPlusAffiliateFrom(TARGET_BY_EMAIL.id)).toBe(AFFILIATE_ACTIVE.id);
  });

  it.each([
    ['liker ID', TARGET_BY_ID.id, TARGET_BY_ID.id],
    ['EVM wallet', TARGET_BY_WALLET.wallet, TARGET_BY_WALLET.id],
  ])('finds the target user by %s', async (_label, query, userId) => {
    const result = await setUserPlusAffiliate(query, AFFILIATE_ACTIVE.id);
    expect(result.user).toBe(userId);
    expect(result.previousPlusAffiliateFrom).toBeUndefined();
    expect(await getPlusAffiliateFrom(userId)).toBe(AFFILIATE_ACTIVE.id);
  });

  it('rejects a target user that does not exist', async () => {
    await expect(setUserPlusAffiliate('nobody@example.com', AFFILIATE_ACTIVE.id))
      .rejects.toThrow('User not found');
  });

  it.each([
    ['does not exist', 'psaffnobody', 'Affiliate not found'],
    ['is only a handle', 'psaffrenamed', 'Affiliate not found'],
    ['is given with an @ prefix', `@${AFFILIATE_ACTIVE.id}`, 'Affiliate not found'],
    ['has an inactive config', AFFILIATE_INACTIVE.id, 'no active affiliate config'],
    ['has no config', AFFILIATE_NO_CONFIG.id, 'no active affiliate config'],
  ])('rejects an affiliate that %s without writing', async (_label, affiliate, message) => {
    await expect(setUserPlusAffiliate(TARGET_UNCHANGED.id, affiliate))
      .rejects.toThrow(message);
    expect(await getPlusAffiliateFrom(TARGET_UNCHANGED.id)).toBe('oldaffiliate');
  });
});
