import crypto from 'crypto';
import Crisp from 'crisp-api';

import {
  CRISP_USER_HASH_SECRET,
  CRISP_PLUGIN_IDENTIFIER,
  CRISP_PLUGIN_KEY,
  CRISP_WEBSITE_ID,
  CRISP_WALLET_TO_SEGMENT_MAPPING,
} from '../../config/config';

const CrispClient = new Crisp();

const isCrispPluginEnabled = CRISP_WEBSITE_ID && CRISP_PLUGIN_IDENTIFIER && CRISP_PLUGIN_KEY;
if (isCrispPluginEnabled) {
  CrispClient.authenticateTier(
    'plugin',
    CRISP_PLUGIN_IDENTIFIER,
    CRISP_PLUGIN_KEY,
  );
}

export function getCrispUserHash(email: string) {
  if (!CRISP_USER_HASH_SECRET || !email) return undefined;
  return crypto
    .createHmac('sha256', CRISP_USER_HASH_SECRET)
    .update(email)
    .digest('hex');
}

export async function upsertCrispProfile(
  email: string,
  {
    displayName, wallet, loginMethod, segments,
  }: {
    displayName?: string,
    wallet?: string,
    loginMethod?: string,
    segments?: string[],
  },
) {
  if (!isCrispPluginEnabled) return;
  let people: any = null;
  try {
    people = await CrispClient.website.getPeopleProfile(CRISP_WEBSITE_ID, email);
  } catch {
    // do nothing
  }
  if (people) {
    await CrispClient.website.updatePeopleProfile(CRISP_WEBSITE_ID, email, {
      person: {
        nickname: displayName || wallet,
      },
      segments: (people.segments || []).concat(segments),
      active: Date.now(),
    });
  } else {
    await CrispClient.website.addNewPeopleProfile(CRISP_WEBSITE_ID, {
      email,
      person: {
        nickname: displayName || wallet || email.split('@')[0],
      },
      segments,
      active: Date.now(),
    });
  }
  await CrispClient.website.updatePeopleData(CRISP_WEBSITE_ID, email, {
    like_wallet: wallet,
    login_method: loginMethod,
  });
}

export function getReaderSegmentNameFromAuthorWallet(ownerWallet: string) {
  // Note that we are often using owner wallet instead of author
  if (CRISP_WALLET_TO_SEGMENT_MAPPING?.[ownerWallet]) {
    return CRISP_WALLET_TO_SEGMENT_MAPPING[ownerWallet];
  }
  return undefined;
}
