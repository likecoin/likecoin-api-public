import {
  describe, it, expect, vi,
} from 'vitest';
import jsonStringify from 'fast-json-stable-stringify';
import sigUtil from 'eth-sig-util';
import web3Utils from 'web3-utils';
import { ValidationError } from '../../src/util/ValidationError';
import {
  checkCosmosSignPayload,
  checkEVMSignPayload,
  normalizeUserEmail,
  FIVE_MIN_IN_MS,
} from '../../src/util/api/users/index';
import { signWithPrivateKey as signWithCosmos } from '../api/cosmos';
import {
  testingCosmosWallet0,
  testingLikeWallet0,
  testingWallet0,
  privateKey0,
  privateKey1,
} from '../api/data';

// Note: Firebase is already mocked in test/setup.ts with FirebaseStub

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

function signERCProfile(signData, privateKey) {
  const privKey = Buffer.from(privateKey.slice(2), 'hex');
  return sigUtil.personalSign(privKey, { data: web3Utils.utf8ToHex(signData) });
}

// cosmosPrivateKeyNew from test/api/data.ts is
// '6a47b2c6557573c1e4dd82563c64a6db3abefad4ea722093b4eeec204ebd9a3a' (no 0x prefix)
// We need to add 0x prefix for the Buffer.from(privateKey, 'hex') to work correctly
const cosmosPrivateKeyNewWithPrefix = '0x6a47b2c6557573c1e4dd82563c64a6db3abefad4ea722093b4eeec204ebd9a3a';

describe('User Signature Verification Unit Tests', () => {
  describe('checkCosmosSignPayload', () => {
    it('should verify valid Cosmos signature', () => {
      const payload = {
        ts: Date.now(),
        cosmosWallet: testingCosmosWallet0,
      };
      // Use cosmosPrivateKeyNew which generates testingCosmosWallet0
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyNewWithPrefix.slice(2));

      // The message is an object, so stringify it for the signature verification
      const result = checkCosmosSignPayload({
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
        inputWallet: testingCosmosWallet0,
      });

      expect(result).toMatchObject({
        cosmosWallet: testingCosmosWallet0,
        ts: payload.ts,
      });
    });

    it('should verify valid Like wallet signature', () => {
      const payload = {
        ts: Date.now(),
        likeWallet: testingLikeWallet0,
      };
      // Use the private key with proper format (without 0x for secp256k1)
      const cosmosPrivateKeyRaw = cosmosPrivateKeyNewWithPrefix.slice(2);
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyRaw);

      const result = checkCosmosSignPayload({
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
        inputWallet: testingLikeWallet0,
      });

      expect(result).toMatchObject({
        likeWallet: testingLikeWallet0,
        ts: payload.ts,
      });
    });

    it('should reject invalid signature', () => {
      const payload = {
        ts: Date.now(),
        cosmosWallet: testingCosmosWallet0,
      };
      const {
        signed: message,
        signature: { pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyNewWithPrefix.slice(2));

      // Create a valid base64 signature that's cryptographically invalid
      // Use 64 bytes of zeros (valid base64, invalid signature)
      const invalidSignature = Buffer.alloc(64, 0).toString('base64');

      expect(() => {
        checkCosmosSignPayload({
          signature: invalidSignature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkCosmosSignPayload({
          signature: invalidSignature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
        });
      }).toThrow('INVALID_SIGNATURE');
    });

    it('should reject mismatched wallet address', () => {
      const payload = {
        ts: Date.now(),
        cosmosWallet: testingCosmosWallet0,
      };
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyNewWithPrefix.slice(2));

      expect(() => {
        checkCosmosSignPayload({
          signature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: 'cosmos1differentwalletaddress',
        });
      }).toThrow(ValidationError);
    });

    it('should reject expired payload', () => {
      const expiredTs = Date.now() - FIVE_MIN_IN_MS - 1000;
      const payload = {
        ts: expiredTs,
        cosmosWallet: testingCosmosWallet0,
      };
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyNewWithPrefix.slice(2));

      expect(() => {
        checkCosmosSignPayload({
          signature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkCosmosSignPayload({
          signature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
        });
      }).toThrow('PAYLOAD_EXPIRED');
    });

    it('should reject future payload', () => {
      const futureTs = Date.now() + FIVE_MIN_IN_MS + 1000;
      const payload = {
        ts: futureTs,
        cosmosWallet: testingCosmosWallet0,
      };
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyNewWithPrefix.slice(2));

      expect(() => {
        checkCosmosSignPayload({
          signature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkCosmosSignPayload({
          signature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
        });
      }).toThrow('PAYLOAD_EXPIRED');
    });

    it('should verify action when specified and matches', () => {
      const payload = {
        ts: Date.now(),
        cosmosWallet: testingCosmosWallet0,
        action: 'login',
      };
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyNewWithPrefix.slice(2));

      const result = checkCosmosSignPayload({
        signature,
        publicKey: publicKey.value,
        message: jsonStringify(message),
        inputWallet: testingCosmosWallet0,
        action: 'login',
      });

      expect(result.action).toBe('login');
    });

    it('should reject when action does not match', () => {
      const payload = {
        ts: Date.now(),
        cosmosWallet: testingCosmosWallet0,
        action: 'login',
      };
      const {
        signed: message,
        signature: { signature, pub_key: publicKey },
      } = signWithCosmos(payload, cosmosPrivateKeyNewWithPrefix.slice(2));

      expect(() => {
        checkCosmosSignPayload({
          signature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
          action: 'register',
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkCosmosSignPayload({
          signature,
          publicKey: publicKey.value,
          message: jsonStringify(message),
          inputWallet: testingCosmosWallet0,
          action: 'register',
        });
      }).toThrow('PAYLOAD_ACTION_NOT_MATCH');
    });
  });

  describe('checkEVMSignPayload', () => {
    it('should verify valid EVM signature', () => {
      const payload = {
        ts: Date.now(),
        evmWallet: testingWallet0,
      };
      const message = JSON.stringify(payload);
      const sign = signERCProfile(message, privateKey0);

      const result = checkEVMSignPayload({
        signature: sign,
        message,
        inputWallet: testingWallet0,
      });

      expect(result).toMatchObject({
        evmWallet: testingWallet0,
        ts: payload.ts,
      });
    });

    it('should reject invalid signature', () => {
      const payload = {
        ts: Date.now(),
        evmWallet: testingWallet0,
      };
      const message = JSON.stringify(payload);

      // When the signature is malformed (not valid hex), sigUtil.recoverPersonalSignature
      // throws a generic Error, not ValidationError. The test verifies this behavior.
      expect(() => {
        checkEVMSignPayload({
          signature: '0xinvalidsignature',
          message,
          inputWallet: testingWallet0,
        });
      }).toThrow(Error);

      // For a valid hex signature that's cryptographically invalid (wrong signer),
      // the function throws ValidationError with RECOVERED_ADDRESS_NOT_MATCH
      expect(() => {
        checkEVMSignPayload({
          signature: signERCProfile(message, privateKey1), // Sign with different key
          message,
          inputWallet: testingWallet0,
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkEVMSignPayload({
          signature: signERCProfile(message, privateKey1), // Sign with different key
          message,
          inputWallet: testingWallet0,
        });
      }).toThrow('RECOVERED_ADDRESS_NOT_MATCH');
    });

    it('should reject mismatched wallet address', () => {
      const payload = {
        ts: Date.now(),
        evmWallet: testingWallet0,
      };
      const message = JSON.stringify(payload);
      const sign = signERCProfile(message, privateKey0);

      expect(() => {
        checkEVMSignPayload({
          signature: sign,
          message,
          inputWallet: '0xDifferentWalletAddress',
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkEVMSignPayload({
          signature: sign,
          message,
          inputWallet: '0xDifferentWalletAddress',
        });
      }).toThrow('RECOVERED_ADDRESS_NOT_MATCH');
    });

    it('should reject expired payload', () => {
      const expiredTs = Date.now() - FIVE_MIN_IN_MS - 1000;
      const payload = {
        ts: expiredTs,
        evmWallet: testingWallet0,
      };
      const message = JSON.stringify(payload);
      const sign = signERCProfile(message, privateKey0);

      expect(() => {
        checkEVMSignPayload({
          signature: sign,
          message,
          inputWallet: testingWallet0,
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkEVMSignPayload({
          signature: sign,
          message,
          inputWallet: testingWallet0,
        });
      }).toThrow('PAYLOAD_EXPIRED');
    });

    it('should verify action when specified and matches', () => {
      const payload = {
        ts: Date.now(),
        evmWallet: testingWallet0,
        action: 'login',
      };
      const message = JSON.stringify(payload);
      const sign = signERCProfile(message, privateKey0);

      const result = checkEVMSignPayload({
        signature: sign,
        message,
        inputWallet: testingWallet0,
        action: 'login',
      });

      expect(result.action).toBe('login');
    });

    it('should reject when action does not match', () => {
      const payload = {
        ts: Date.now(),
        evmWallet: testingWallet0,
        action: 'login',
      };
      const message = JSON.stringify(payload);
      const sign = signERCProfile(message, privateKey0);

      expect(() => {
        checkEVMSignPayload({
          signature: sign,
          message,
          inputWallet: testingWallet0,
          action: 'register',
        });
      }).toThrow(ValidationError);
      expect(() => {
        checkEVMSignPayload({
          signature: sign,
          message,
          inputWallet: testingWallet0,
          action: 'register',
        });
      }).toThrow('PAYLOAD_ACTION_NOT_MATCH');
    });
  });

  describe('normalizeUserEmail', () => {
    it('should normalize valid email', async () => {
      const { default: axios } = await import('axios');
      vi.mocked(axios.get).mockResolvedValue({ data: { disposable: false } });

      const result = await normalizeUserEmail('user', 'test@example.com');

      // normalizeUserEmail normalizes the email (lowercase, removes dots/plus for
      // gmail-like domains). The result depends on the email domain
      expect(result.normalizedEmail).toBeDefined();
      expect(result.isEmailInvalid).toBe(false);
    });

    it('should handle dot removal for email normalization', async () => {
      const { default: axios } = await import('axios');
      vi.mocked(axios.get).mockResolvedValue({ data: { disposable: false } });

      const result = await normalizeUserEmail('user', 'u.ser@example.com');

      expect(result.normalizedEmail).toBeDefined();
      expect(result.isEmailInvalid).toBe(false);
    });

    it('should handle plus address removal', async () => {
      const { default: axios } = await import('axios');
      vi.mocked(axios.get).mockResolvedValue({ data: { disposable: false } });

      const result = await normalizeUserEmail('user', 'user+tag@example.com');

      expect(result.normalizedEmail).toBeDefined();
      expect(result.isEmailInvalid).toBe(false);
    });

    it('should detect invalid email format', async () => {
      // No need to mock axios for this test since normalizeUserEmail returns early
      // for invalid email formats before making any API calls
      const result = await normalizeUserEmail('user', 'invalid-email');

      // Invalid email format returns normalizedEmail as undefined
      expect(result.normalizedEmail).toBeUndefined();
      // The function doesn't set isEmailInvalid in this case
    });

    it('should return empty object for empty email', async () => {
      const result = await normalizeUserEmail('user', '');

      expect(result).toEqual({});
    });

    it('should return empty object for undefined email', async () => {
      const result = await normalizeUserEmail('user', undefined as any);

      expect(result).toEqual({});
    });

    it('should handle disposable email domains', async () => {
      // No need to mock axios for this test since 10minutemail.com is in the
      // disposable-email-domains package and is checked before any API call
      const result = await normalizeUserEmail('user', 'user@10minutemail.com');

      // 10minutemail.com is in disposable-email-domains package
      // The function sets isEmailBlacklisted to true
      expect(result.isEmailBlacklisted).toBe(true);
    });
  });
});
