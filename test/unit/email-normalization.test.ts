import {
  describe, it, expect,
} from 'vitest';
import { ValidationError } from '../../src/util/ValidationError';
import {
  getNormalizedEmail,
  getMatchableNormalizedEmail,
  findLikerByEmail,
  userOrWalletByEmailQuery,
} from '../../src/util/api/users/index';

// Note: Firebase is already mocked in test/setup.ts with FirebaseStub, seeded
// from test/data/user.json (see testgmaillegacy / testprotonlegacy).

describe('getNormalizedEmail', () => {
  it('strips dots and plus-tags for Gmail-family domains', () => {
    expect(getNormalizedEmail('John.Doe+book@Gmail.com')).toBe('johndoe@gmail.com');
  });

  it('strips the +tag but keeps dots for plus-addressing providers', () => {
    expect(getNormalizedEmail('John.Roe+news@Proton.me')).toBe('john.roe@proton.me');
    expect(getNormalizedEmail('A.B+tag@Outlook.com')).toBe('a.b@outlook.com');
  });

  it('lowercases the local part and domain', () => {
    expect(getNormalizedEmail('USER@Example.COM')).toBe('user@example.com');
  });

  it('keeps dots for non-Gmail domains to avoid inbox collisions', () => {
    // a.b@example.com and ab@example.com are different inboxes on a generic
    // provider, so dots must survive normalization.
    expect(getNormalizedEmail('a.b+tag@example.com')).toBe('a.b@example.com');
  });

  it('returns undefined for falsy or malformed input', () => {
    expect(getNormalizedEmail('')).toBeUndefined();
    expect(getNormalizedEmail('no-at-sign')).toBeUndefined();
    expect(getNormalizedEmail('@gmail.com')).toBeUndefined();
    expect(getNormalizedEmail('a@b@c')).toBeUndefined();
  });
});

describe('getMatchableNormalizedEmail', () => {
  it('returns normalizedEmail for Gmail-family and plus-addressing providers', () => {
    expect(getMatchableNormalizedEmail('John.Doe+x@gmail.com')).toBe('johndoe@gmail.com');
    expect(getMatchableNormalizedEmail('john+tag@proton.me')).toBe('john@proton.me');
    expect(getMatchableNormalizedEmail('a.b+x@outlook.com')).toBe('a.b@outlook.com');
  });

  it('returns undefined for providers where matching is unsafe', () => {
    // Yahoo uses hyphen disposable addresses, not plus subaddressing.
    expect(getMatchableNormalizedEmail('user@yahoo.com')).toBeUndefined();
    expect(getMatchableNormalizedEmail('user@likecoin.store')).toBeUndefined();
  });

  it('returns undefined for falsy input', () => {
    expect(getMatchableNormalizedEmail('')).toBeUndefined();
  });
});

describe('findLikerByEmail', () => {
  it('finds an account by exact email', async () => {
    const user = await findLikerByEmail('testing@likecoin.store');
    expect(user?.user).toBe('testing');
  });

  it('matches a Gmail account by normalizedEmail', async () => {
    // Stored email is "John.Doe+book@gmail.com"; a different but
    // normalized-equivalent address must still resolve the account.
    const user = await findLikerByEmail('johndoe@gmail.com');
    expect(user?.user).toBe('testgmaillegacy');
    expect(user?.likeWallet).toBe('like1gmaillegacy00000000000000000000000000');
    expect(user?.evmWallet).toBeUndefined();
  });

  it('matches a plus-addressing account by normalizedEmail, keeping dots', async () => {
    // Stored email is "John.Roe+news@proton.me"; the same inbox without the tag
    // (and with different case) must still resolve via normalizedEmail.
    const user = await findLikerByEmail('john.roe@proton.me');
    expect(user?.user).toBe('testprotonlegacy');
    const tagged = await findLikerByEmail('John.Roe+promo@proton.me');
    expect(tagged?.user).toBe('testprotonlegacy');
  });

  it('keeps dots significant for plus-addressing providers', async () => {
    // proton treats dots as significant, so the dotless variant is a different
    // inbox and must NOT match.
    const user = await findLikerByEmail('johnroe@proton.me');
    expect(user).toBeUndefined();
  });

  it('returns undefined when nothing matches', async () => {
    const user = await findLikerByEmail('nobody@gmail.com');
    expect(user).toBeUndefined();
  });
});

describe('userOrWalletByEmailQuery', () => {
  it('passes when no account uses the email', async () => {
    await expect(
      userOrWalletByEmailQuery({ evmWallet: '0xNEW' }, 'free-email@gmail.com', true),
    ).resolves.toBe(true);
  });

  it('throws EMAIL_ALREADY_USED for a normalized Proton match', async () => {
    await expect(
      userOrWalletByEmailQuery({ evmWallet: '0xNEW' }, 'John.Roe+promo@proton.me', true),
    ).rejects.toThrow(ValidationError);
  });

  it('throws EMAIL_ALREADY_USED for a normalized Gmail match', async () => {
    // Incoming Magic login with a fresh EVM wallet hits a legacy likeWallet-only
    // account via normalized email — the conflict must be surfaced so the client
    // can trigger the auto-link migration.
    await expect(
      userOrWalletByEmailQuery({ evmWallet: '0xNEW' }, 'johndoe@gmail.com', true),
    ).rejects.toThrow(ValidationError);
  });

  it('exposes a masked payload only when the email is verified', async () => {
    try {
      await userOrWalletByEmailQuery({ evmWallet: '0xNEW' }, 'johndoe@gmail.com', true);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const { payload } = err as ValidationError;
      expect(payload.evmWallet).toBeUndefined();
      expect(typeof payload.likeWallet).toBe('string');
    }

    try {
      await userOrWalletByEmailQuery({ evmWallet: '0xNEW' }, 'johndoe@gmail.com', false);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).payload).toBeNull();
    }
  });
});
