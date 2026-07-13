import {
  vi, beforeEach,
} from 'vitest';
import * as FirebaseStub from './stub/firebase';

// Set test environment variables BEFORE any imports
process.env.IS_TESTNET = 'true';
// config/config.js reads these at import time; the vi.mock below does not reach
// source imports (its path resolves outside the repo), so env is the real lever.
process.env.REVENUECAT_WEBHOOK_AUTHORIZATION = 'test-rc-webhook-secret';
process.env.REVENUECAT_PLUS_MONTHLY_PRODUCT_IDS = 'rc_plus_monthly';
process.env.REVENUECAT_PLUS_YEARLY_PRODUCT_IDS = 'rc_plus_yearly';
process.env.AIRTABLE_AUTOMATION_TOKEN = 'test-airtable-automation-token';
process.env.PLUS_READING_SERVICE_TOKEN = 'test-plus-reading-service-token';
process.env.ALCHEMY_GAS_POLICY_ID = 'test-alchemy-policy-id';
process.env.ALCHEMY_SPONSORSHIP_WEBHOOK_SECRET = 'test-alchemy-webhook-secret';
process.env.PLUS_SETTLE_ADMIN_TOKEN = 'test-plus-settle-admin-token';

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
