import {
  vi, beforeEach,
} from 'vitest';
import * as FirebaseStub from './stub/firebase';

// Set test environment variables BEFORE any imports
process.env.IS_TESTNET = 'true';

// Mock config files
vi.mock('../../config/config', () => ({
  FIREBASE_STORAGE_BUCKET: 'test-bucket',
  FIRESTORE_USER_ROOT: 'users',
  FIRESTORE_USER_AUTH_ROOT: 'user-auth',
  FIRESTORE_SUBSCRIPTION_USER_ROOT: 'subscriptions',
  FIRESTORE_SUPERLIKE_USER_ROOT: 'superlike',
  FIRESTORE_TX_ROOT: 'tx',
  FIRESTORE_IAP_ROOT: 'iap',
  FIRESTORE_MISSION_ROOT: 'missions',
  FIRESTORE_PAYOUT_ROOT: 'payout',
  FIRESTORE_COUPON_ROOT: 'coupon',
  FIRESTORE_CONFIG_ROOT: 'config',
  FIRESTORE_OAUTH_CLIENT_ROOT: 'oauth-client',
  FIRESTORE_LIKER_NFT_ROOT: 'likenft',
  FIRESTORE_NFT_SUBSCRIPTION_USER_ROOT: 'nft-subscription',
  FIRESTORE_NFT_FREE_MINT_TX_ROOT: 'nft-free-mint-tx',
  FIRESTORE_LIKER_NFT_BOOK_CART_ROOT: 'nft-book-cart',
  FIRESTORE_LIKER_NFT_BOOK_ROOT: 'nft-book',
  FIRESTORE_LIKER_NFT_BOOK_USER_ROOT: 'nft-book-user',
  FIRESTORE_LIKER_PLUS_GIFT_CART_ROOT: 'plus-gift-cart',
  FIRESTORE_LIKE_URL_ROOT: 'like-button',
  FIRESTORE_ISCN_INFO_ROOT: 'iscn-info',
  FIRESTORE_ISCN_ARWEAVE_TX_ROOT: 'iscn-arweave-tx',
  FIRESTORE_ISCN_LIKER_URL_ROOT: 'iscn-like-button',
}));

vi.mock('../../config/serviceAccountKey.json', () => ({}));

// Mock firebase-admin
vi.mock('firebase-admin', () => ({
  default: {
    apps: [],
    initializeApp: vi.fn(() => ({
      firestore: vi.fn(() => ({})),
      storage: vi.fn(() => ({
        bucket: vi.fn(() => ({})),
      })),
    })),
    credential: {
      cert: vi.fn(() => ({})),
    },
    firestore: {
      FieldValue: {
        serverTimestamp: vi.fn(() => ({ toDate: vi.fn(() => new Date()) })),
        increment: vi.fn((n: number) => n),
        arrayUnion: vi.fn((...items: unknown[]) => items),
        arrayRemove: vi.fn((...items: unknown[]) => items),
        delete: vi.fn(() => null),
      },
      Timestamp: {
        now: vi.fn(() => ({ toDate: vi.fn(() => new Date()) })),
        fromDate: vi.fn((d: Date) => ({ toDate: vi.fn(() => d) })),
      },
    },
  },
}));

// Mock src/util/firebase with in-memory stub
vi.mock('../src/util/firebase', () => ({
  ...FirebaseStub,
  resetTestData: vi.fn(() => FirebaseStub.resetTestData()),
}));

// Clear mocks and reset test data before each test
beforeEach(async () => {
  vi.clearAllMocks();
  FirebaseStub.resetTestData();
});

// Mock other external services
vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SES: vi.fn().mockImplementation(() => ({
    sendEmail: () => Promise.resolve(),
  })),
}));

// Cosmos API mock
vi.mock('../src/util/cosmos/api', () => ({
  createAPIEndpoint: () => ({
    get: () => ({ status: 200, data: { result: { value: {} } } }),
    post: () => ({ status: 200, data: { result: { value: {} } } }),
  }),
}));

// Like price API mock
vi.mock('../src/util/api/likernft/likePrice', () => ({
  getLIKEPrice: async ({ raw = false } = {}) => (raw ? 0.001 : Math.max(0.001, 0.0001)),
  default: Promise.resolve(0.001),
}));

// File upload mock
vi.mock('../src/util/fileupload', () => ({
  uploadFileAndGetLink: () => 'https://example.com/file.jpg',
  handleAvatarUploadAndGetURL: () => ({
    url: 'https://example.com/avatar.jpg',
    hash: 'abc123',
  }),
}));
