import { describe, it, expect } from 'vitest';
import type { ZodTypeAny } from 'zod';

import {
  filterNFTBookListingInfo,
  filterBookPurchaseData,
  filterBookPurchaseCommission,
  filterLikeNFTMetadata,
  filterLikeNFTISCNData,
  filterUserData,
} from '../../src/util/ValidationHelper';
import {
  BookContributorSchema,
  NFTBookListingInfoFilteredSchema,
  BookPurchaseDataFilteredSchema,
  BookPurchaseCommissionFilteredSchema,
} from '../../src/util/api/likernft/book/schemas';
import {
  LikeNFTMetadataResponseSchema,
  LikeNFTISCNDataResponseSchema,
} from '../../src/util/api/likernft/schemas';
import {
  AffiliateConfigSchema,
  PlusAffiliateResponseSchema,
} from '../../src/util/api/plus/schemas';
import {
  UserDataFilteredResponseSchema,
} from '../../src/util/api/users/schemas';
import {
  WalletEvmMigrateResponseSchema,
} from '../../src/util/api/wallet/schemas';

// Regression guard for the recurring "response schema stricter than real data" 500s.
// Each case reproduces a legacy/partial Firestore shape that 500'd a live endpoint
// (see the matching 🐛 fix commit) and asserts the schema now accepts it. Where a
// filter function sits in front of the schema, we run the real filter→schema path so
// the test fails if either side drifts back to being too strict.

// Firestore Timestamp stand-in: the filters call `.toMillis()`.
const ts = (millis: number) => ({ toMillis: () => millis });

function expectParses(schema: ZodTypeAny, data: unknown) {
  const result = schema.safeParse(data);
  // Assert on the issues so a failure prints what was rejected, not a bare `false`.
  expect(result.error?.issues ?? []).toEqual([]);
}

describe('Response schema ↔ legacy data alignment', () => {
  describe('BookContributorSchema (author/publisher: legacy string vs newer object)', () => {
    it('accepts a legacy plain-string contributor', () => {
      expectParses(BookContributorSchema, 'Some Author Name');
    });
    it('accepts a newer object contributor with extra keys', () => {
      expectParses(BookContributorSchema, { name: 'Author', url: 'https://x', extra: 1 });
    });
  });

  describe('NFTBookListingInfoFilteredSchema (filter→schema)', () => {
    it('accepts a legacy doc: string author, object publisher, signed signature, no approval flags', () => {
      const legacyDoc: any = {
        classId: 'class-legacy',
        ownerWallet: '0xowner',
        // author stored verbatim from ISCN metadata as a plain string (commit d8bf8115)
        author: 'Legacy Author String',
        // publisher as object (commit 8ebf307f)
        publisher: { name: 'Legacy Publisher', url: 'https://pub' },
        // enableSignatureImage can be the literal 'signed' (commit acc088fc)
        enableSignatureImage: 'signed',
        timestamp: ts(1700000000000),
        // approval flags absent on old books — filter defaults them to true
      };
      expectParses(NFTBookListingInfoFilteredSchema, filterNFTBookListingInfo(legacyDoc, true));
    });
  });

  describe('BookPurchaseDataFilteredSchema (filter→schema)', () => {
    it('accepts a purchase doc with null txHash and no timestamp', () => {
      // null txHash (commit 0769894f); quantity defaulted by the filter
      const doc: any = { id: 'p1', classId: 'class-1', txHash: null };
      expectParses(BookPurchaseDataFilteredSchema, filterBookPurchaseData(doc));
    });
  });

  describe('BookPurchaseCommissionFilteredSchema (filter→schema)', () => {
    it('accepts a legacy commission doc missing ownerWallet', () => {
      // ownerWallet predates legacy commission docs (commit 4d34d746)
      const doc: any = {
        type: 'royalty',
        paymentId: 'pay-1',
        amountTotal: 1000,
        amount: 300,
        currency: 'usd',
        timestamp: ts(1700000000000),
      };
      expectParses(BookPurchaseCommissionFilteredSchema, filterBookPurchaseCommission(doc));
    });
  });

  describe('LikeNFTMetadataResponseSchema (filter→schema)', () => {
    it('accepts ISO-string iscn_record_timestamp and passes through extra keys', () => {
      // iscn_record_timestamp is an ISO string, not a number (commit d8bf8115)
      const meta: any = {
        name: 'NFT',
        iscnId: 'iscn://x',
        iscnRecordTimestamp: '2024-01-01T00:00:00Z',
        customKey: 'kept by passthrough',
      };
      expectParses(LikeNFTMetadataResponseSchema, filterLikeNFTMetadata(meta));
    });
  });

  describe('LikeNFTISCNDataResponseSchema (filter→schema)', () => {
    it('accepts a minimal ISCN doc with only required fields', () => {
      const doc: any = { iscnId: 'iscn://x', classId: 'class-1' };
      expectParses(LikeNFTISCNDataResponseSchema, filterLikeNFTISCNData(doc));
    });
  });

  describe('AffiliateConfig / PlusAffiliateResponseSchema (inline-built)', () => {
    it('tolerates a gift book without classId and a custom voice missing fields', () => {
      // legacy partial affiliate entries (commit 117c4731)
      const config = {
        active: true as const,
        affiliateClassIds: [],
        affiliatePublisherWallets: [],
        giftBooks: [{ priceIndex: 0 }], // no classId
        giftOnTrial: false,
        customVoices: [{}], // missing every optional field
      };
      expectParses(AffiliateConfigSchema, config);
      expectParses(PlusAffiliateResponseSchema, { ...config, isPlusDiscountAllowed: true });
    });

    it('still accepts the inactive-affiliate variant of the discriminated union', () => {
      expectParses(PlusAffiliateResponseSchema, { active: false, isPlusDiscountAllowed: false });
    });
  });

  describe('UserDataFilteredResponseSchema (filter→schema)', () => {
    it('accepts a legacy locale code outside supportedLocales (e.g. "cn")', () => {
      const filtered = filterUserData({ user: 'legacyuser', locale: 'cn' } as any);
      expectParses(UserDataFilteredResponseSchema, filtered);
    });
  });

  describe('WalletEvmMigrateResponseSchema (migratedLikerLandUser allowlist)', () => {
    const base = {
      isMigratedBookUser: true,
      isMigratedBookOwner: true,
      isMigratedLikerId: true,
      isMigratedLikerLand: true,
      migratedLikerId: 'liker-1',
      migrateBookUserError: null,
      migrateBookOwnerError: null,
      migrateLikerIdError: null,
      migrateLikerLandError: null,
    };

    it('strips extra (potentially PII) keys from the raw liker-land user object', () => {
      // migratedLikerLandUser is the raw liker-land migrate body (commit 49dfbddd);
      // only the allowlisted fields should survive.
      const parsed = WalletEvmMigrateResponseSchema.parse({
        ...base,
        migratedLikerLandUser: {
          id: 'u1',
          likeWallet: 'like1',
          lastLoginMethod: 'magic',
          registerLoginMethod: 'wallet',
          email: 'secret@pii.com',
          displayName: 'Bob',
        },
      });
      expect(parsed.migratedLikerLandUser).toEqual({
        id: 'u1',
        likeWallet: 'like1',
        lastLoginMethod: 'magic',
        registerLoginMethod: 'wallet',
      });
    });

    it('accepts null (migration not run) and partial/missing inner fields', () => {
      expectParses(WalletEvmMigrateResponseSchema, { ...base, migratedLikerLandUser: null });
      expectParses(WalletEvmMigrateResponseSchema, {
        ...base,
        migratedLikerLandUser: { likeWallet: 'like1' },
      });
    });

    it('coerces a non-object upstream body to null instead of 500ing', () => {
      // liker-land could 200 with an empty string / array body; must not throw.
      const S = WalletEvmMigrateResponseSchema;
      expect(S.parse({ ...base, migratedLikerLandUser: '' }).migratedLikerLandUser).toBeNull();
      expect(S.parse({ ...base, migratedLikerLandUser: [] }).migratedLikerLandUser).toBeNull();
    });
  });
});
