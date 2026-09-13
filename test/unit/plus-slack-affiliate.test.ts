import {
  beforeAll, beforeEach, describe, expect, it,
} from 'vitest';
import { checksumAddress } from 'viem';

import { listPlusAffiliates } from '../../src/util/api/plus/slack';
import { clearHandleCache } from '../../src/util/api/users/handle';
import { formatPlusAffiliateListSlackText } from '../../src/util/slack';
import { likeNFTBookUserCollection, userCollection } from '../../src/util/firebase';

function walletOf(seed: string) {
  return checksumAddress(`0x${seed.repeat(20)}`);
}

// The user stub is not reset between tests, so these are seeded once
// under ids unique to this file.
const AFFILIATE_ACTIVE = { id: 'psaffactive', wallet: walletOf('a1') };
const AFFILIATE_INACTIVE = { id: 'psaffinactive', wallet: walletOf('a2') };

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
});

beforeEach(() => {
  clearHandleCache();
});

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
