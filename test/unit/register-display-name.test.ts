import {
  describe, expect, it,
} from 'vitest';

import { handleUserRegistration } from '../../src/util/api/users/register';
import { userCollection } from '../../src/util/firebase';
import {
  DISPLAY_NAME_PLACES_HK,
  DISPLAY_NAME_PLACES_TW,
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

async function storedUser(user: string) {
  return (await userCollection.doc(user).get()).data();
}

async function storedDisplayName(user: string) {
  return (await storedUser(user))?.displayName;
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

  it('names a Hong Kong signup after a Hong Kong place', async () => {
    const registration = makeRegistration('pqrstv');
    registration.req.headers = { 'cf-ipcountry': 'HK' };
    await handleUserRegistration(registration);
    const [place] = (await storedDisplayName('pqrstv') as string).split('的');
    expect(DISPLAY_NAME_PLACES_HK).toContain(place);
  });

  // The route leaves an absent locale undefined precisely so this stays English:
  // `defaultLocale` is 'zh', and defaulting first would name everyone in Chinese.
  it('names a signup with no country and no locale in English', async () => {
    await handleUserRegistration(makeRegistration('wxyzab'));
    const name = await storedDisplayName('wxyzab') as string;
    expect(DISPLAY_NAME_PLACES_EN).toContain(name.slice(0, name.lastIndexOf("'s ")));
  });

  it('trusts the relayed body country over the relay server\'s own header', async () => {
    const registration = makeRegistration('hkrelay');
    registration.req.headers = { 'cf-ipcountry': 'TW' };
    registration.req.body = { ipCountry: 'hk' };
    await handleUserRegistration(registration);
    const { displayName, registerRegion } = await storedUser('hkrelay') as any;
    expect(DISPLAY_NAME_PLACES_HK).toContain(displayName.split('的')[0]);
    expect(registerRegion).toBe('HK');
  });

  it('falls back to the header for a direct signup', async () => {
    const registration = makeRegistration('twdirect');
    registration.req.headers = { 'cf-ipcountry': 'TW' };
    await handleUserRegistration(registration);
    const { displayName, registerRegion } = await storedUser('twdirect') as any;
    expect(DISPLAY_NAME_PLACES_TW).toContain(displayName.split('的')[0]);
    expect(registerRegion).toBe('TW');
  });

  it('records no region and names by locale when the country is unknown', async () => {
    await handleUserRegistration(makeRegistration('noregion', { locale: 'en' }));
    const { displayName, registerRegion } = await storedUser('noregion') as any;
    expect(DISPLAY_NAME_PLACES_EN).toContain(displayName.slice(0, displayName.lastIndexOf("'s ")));
    expect(registerRegion).toBeUndefined();
  });

  // An unknown body country must not fall through to the header, which names the relay.
  it('ignores Cloudflare placeholders without falling back to the header', async () => {
    const registration = makeRegistration('torsignup', { locale: 'en' });
    registration.req.headers = { 'cf-ipcountry': 'TW' };
    registration.req.body = { ipCountry: 'T1' };
    await handleUserRegistration(registration);
    const { displayName, registerRegion } = await storedUser('torsignup') as any;
    expect(DISPLAY_NAME_PLACES_EN).toContain(displayName.slice(0, displayName.lastIndexOf("'s ")));
    expect(registerRegion).toBeUndefined();

    const direct = makeRegistration('xxsignup', { locale: 'en' });
    direct.req.headers = { 'cf-ipcountry': 'XX' };
    await handleUserRegistration(direct);
    expect((await storedUser('xxsignup') as any).registerRegion).toBeUndefined();

    const blank = makeRegistration('blanksignup', { locale: 'en' });
    blank.req.headers = { 'cf-ipcountry': 'TW' };
    blank.req.body = { ipCountry: '' };
    await handleUserRegistration(blank);
    expect((await storedUser('blanksignup') as any).registerRegion).toBeUndefined();
  });
});
