import {
  describe, expect, it,
} from 'vitest';

import { handleUserRegistration } from '../../src/util/api/users/register';
import { userCollection } from '../../src/util/firebase';
import {
  DISPLAY_NAME_PLACES_ZH,
  DISPLAY_NAME_PLACES_EN,
} from '../../src/constant/displayName';

// A registration carries a signed payload by the time it reaches this layer, so
// the route's signature check is out of scope here; only the wallet has to parse.
function makeRegistration(user: string, extra: Record<string, unknown> = {}) {
  return {
    payload: {
      user,
      evmWallet: `0x${user.padEnd(40, '0').slice(0, 40)}`,
      platform: 'evmWallet',
      ...extra,
    },
    req: { headers: {}, body: {} } as any,
    res: {} as any,
  };
}

async function storedDisplayName(user: string) {
  return (await userCollection.doc(user).get()).data()?.displayName;
}

describe('registration display name', () => {
  it('never stores the signup handle, which doubles as the referral code', async () => {
    await handleUserRegistration(makeRegistration('mfqxbd'));
    const displayName = await storedDisplayName('mfqxbd');
    expect(displayName).not.toBe('mfqxbd');
    expect(displayName).toMatch(/'s |的/);
  });

  it('keeps a display name the client supplied', async () => {
    await handleUserRegistration(makeRegistration('kwsdvp', { displayName: 'Chosen Name' }));
    expect(await storedDisplayName('kwsdvp')).toBe('Chosen Name');
  });

  it('names a Hong Kong signup in Chinese', async () => {
    const registration = makeRegistration('pqrstv');
    registration.req.headers = { 'cf-ipcountry': 'HK' };
    await handleUserRegistration(registration);
    const [place] = (await storedDisplayName('pqrstv') as string).split('的');
    expect(DISPLAY_NAME_PLACES_ZH).toContain(place);
  });

  // The route leaves an absent locale undefined precisely so this stays English:
  // `defaultLocale` is 'zh', and defaulting first would name everyone in Chinese.
  it('names a signup with no country and no locale in English', async () => {
    await handleUserRegistration(makeRegistration('wxyzab'));
    const name = await storedDisplayName('wxyzab') as string;
    expect(DISPLAY_NAME_PLACES_EN).toContain(name.slice(0, name.lastIndexOf("'s ")));
  });
});
