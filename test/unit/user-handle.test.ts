import {
  beforeEach, describe, expect, it,
} from 'vitest';

import {
  clearHandleCache,
  isHandleAvailable,
  renameUserHandle,
  resolveAttributionUserId,
  resolveUserIdByHandle,
} from '../../src/util/api/users/handle';
import { getUserWithCivicLikerProperties } from '../../src/util/api/users/getPublicInfo';
import { userCollection, likerIdHandleCollection } from '../../src/util/firebase';

// Seeded in test/data/user.json, never renamed: its handle is its document id.
const EXISTING_USER = 'testing';

async function seedUser(id: string) {
  await userCollection.doc(id).set({
    displayName: id,
    evmWallet: `0x${id.padEnd(40, '0').slice(0, 40)}`,
  });
}

describe('liker id handle resolution', () => {
  beforeEach(() => {
    clearHandleCache();
  });

  it('resolves a never-renamed handle through the document-id fallback', async () => {
    expect(await resolveUserIdByHandle(EXISTING_USER)).toBe(EXISTING_USER);
  });

  it('strips the @ prefix and resolves regardless of casing', async () => {
    expect(await resolveUserIdByHandle('@testing')).toBe(EXISTING_USER);
    expect(await resolveUserIdByHandle('@TESTING')).toBe(EXISTING_USER);
  });

  it('returns undefined for an unknown handle', async () => {
    expect(await resolveUserIdByHandle('nobodyhere')).toBeUndefined();
  });

  it('reports an unused handle as available and a taken one as not', async () => {
    expect(await isHandleAvailable('freehandle')).toBe(true);
    expect(await isHandleAvailable(EXISTING_USER)).toBe(false);
  });

  it('rejects a handle that fails the user-id format rules', async () => {
    expect(await isHandleAvailable('AB')).toBe(false);
    expect(await isHandleAvailable('has space')).toBe(false);
  });

  it('stores attribution as the internal id, keeping the handle only when unknown', async () => {
    expect(await resolveAttributionUserId(`@${EXISTING_USER}`)).toBe(EXISTING_USER);
    expect(await resolveAttributionUserId('@NoSuchAffiliate')).toBe('nosuchaffiliate');
  });
});

describe('renameUserHandle', () => {
  beforeEach(() => {
    clearHandleCache();
  });

  it('points both the new handle and the old alias at the same account', async () => {
    await seedUser('renameone');
    const { oldHandle, newHandle } = await renameUserHandle('renameone', 'renamedone');

    expect(oldHandle).toBe('renameone');
    expect(newHandle).toBe('renamedone');
    expect(await resolveUserIdByHandle('renamedone')).toBe('renameone');
    // The whole point of aliasing: links already in circulation keep working.
    expect(await resolveUserIdByHandle('renameone')).toBe('renameone');
  });

  it('keeps the document id — and so the internal identity — unchanged', async () => {
    await seedUser('renametwo');
    await renameUserHandle('renametwo', 'renamedtwo');

    const payload = await getUserWithCivicLikerProperties('renamedtwo');
    expect(payload?.user).toBe('renametwo');
    expect(payload?.handle).toBe('renamedtwo');
  });

  it('never frees the old handle for anyone else', async () => {
    await seedUser('renamethree');
    await renameUserHandle('renamethree', 'renamedthree');

    expect(await isHandleAvailable('renamethree')).toBe(false);
    const alias = await likerIdHandleCollection.doc('renamethree').get();
    expect(alias.data()?.status).toBe('alias');
  });

  it('allows only one rename per account', async () => {
    await seedUser('renamefour');
    await renameUserHandle('renamefour', 'renamedfour');

    await expect(renameUserHandle('renamefour', 'renamedfouragain'))
      .rejects.toThrow('HANDLE_ALREADY_CHANGED');
  });

  it('refuses a handle already held as another account document id', async () => {
    await seedUser('renamefive');
    await expect(renameUserHandle('renamefive', EXISTING_USER))
      .rejects.toThrow('HANDLE_ALREADY_TAKEN');
  });

  it('refuses a handle already claimed as another account alias', async () => {
    await seedUser('renamesix');
    await seedUser('renameseven');
    await renameUserHandle('renamesix', 'renamedsix');

    await expect(renameUserHandle('renameseven', 'renamesix'))
      .rejects.toThrow('HANDLE_ALREADY_TAKEN');
  });

  it('lets a legacy mixed-case id take its own lowercase form, keeping the row active', async () => {
    await seedUser('RenameTen');
    const { oldHandle, newHandle } = await renameUserHandle('RenameTen', 'RenameTen');

    expect(oldHandle).toBe('RenameTen');
    expect(newHandle).toBe('renameten');
    // Old and new share one index row; the alias write must not demote it.
    expect((await likerIdHandleCollection.doc('renameten').get()).data()?.status).toBe('active');
    expect(await resolveUserIdByHandle('renameten')).toBe('RenameTen');
    expect(await resolveUserIdByHandle('RenameTen')).toBe('RenameTen');
  });

  it('never aliases over a lowercase row another account holds', async () => {
    await seedUser('LegacyCase');
    await seedUser('othercase');
    // Nothing holds the lowercase form as a document id, so this rename is allowed.
    await renameUserHandle('othercase', 'legacycase');
    await renameUserHandle('LegacyCase', 'renamedlegacy');

    const row = await likerIdHandleCollection.doc('legacycase').get();
    expect(row.data()?.userId).toBe('othercase');
    expect(row.data()?.status).toBe('active');
    expect(await resolveUserIdByHandle('legacycase')).toBe('othercase');
    expect(await resolveUserIdByHandle('LegacyCase')).toBe('LegacyCase');
  });

  it('rejects a malformed handle', async () => {
    await seedUser('renameeight');
    await expect(renameUserHandle('renameeight', 'no')).rejects.toThrow('INVALID_USER_ID');
  });

  it('keeps attribution resolving to the same account after a rename', async () => {
    await seedUser('renamenine');
    await renameUserHandle('renamenine', 'renamednine');

    expect(await resolveAttributionUserId('@renamednine')).toBe('renamenine');
    // An old referral link still credits the same account.
    expect(await resolveAttributionUserId('@renamenine')).toBe('renamenine');
  });
});
