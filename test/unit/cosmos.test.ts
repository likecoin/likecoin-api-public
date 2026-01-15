import { describe, it, expect } from 'vitest';
import secp256k1 from 'secp256k1';
import createHash from 'create-hash';
import {
  isValidCosmosAddress,
  isValidLikeAddress,
  changeAddressPrefix,
  publicKeyBinaryToAddresses,
  verifyCosmosSignInPayload,
  LIKEToAmount,
  amountToLIKE,
} from '../../src/util/cosmos';

// Use valid test addresses from the actual test data
const validCosmosAddress = 'cosmos187290tx4vj6npyl7fdfgdvxr2n9d5qyell50d4';
const validLikeAddress = 'like187290tx4vj6npyl7fdfgdvxr2n9d5qyevrgdww';

describe('Cosmos Utility Unit Tests', () => {
  describe('isValidCosmosAddress', () => {
    it('should validate correct Cosmos addresses', () => {
      const validAddresses = [
        'cosmos187290tx4vj6npyl7fdfgdvxr2n9d5qyell50d4',
        'cosmos154xjc0r3770jahjnjs46qrdtezqm9htplr0cjl',
      ];

      validAddresses.forEach((address) => {
        expect(isValidCosmosAddress(address)).toBe(true);
      });
    });

    it('should reject invalid Cosmos addresses', () => {
      const invalidAddresses = [
        'cosmos1', // Too short
        'cosmos10', // Too short (but regex might not catch this)
        'cosmos1z', // Too short (fails length check; regex requires 38 chars after "cosmos1")
        'cosmos102r0xzq7y4gj8cq6q9p8j5k5l0m5n5o8p9r0s1', // Wrong length (37 chars)
        'cosmos102r0xzq7y4gj8cq6q9p8j5k5l0m5n5o8p9r0s1t12345', // Too long
        'like187290tx4vj6npyl7fdfgdvxr2n9d5qyevrgdww', // Wrong prefix
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1', // EVM address
        'not-an-address',
        '',
        // Note: isValidCosmosAddress only validates format, not checksum
        // So addresses like 'cosmos1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7t'
        // with invalid checksums will pass
        // because they match the regex /^cosmos1[ac-hj-np-z02-9]{38}$/
      ];

      invalidAddresses.forEach((address) => {
        expect(isValidCosmosAddress(address as any)).toBe(false);
      });
    });

    it('should reject addresses with invalid characters', () => {
      const invalidAddresses = [
        'cosmos1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7!', // Contains '!'
        'cosmos1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7@', // Contains '@'
        'cosmos1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7#', // Contains '#'
        'cosmos1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7 ', // Contains space
      ];

      invalidAddresses.forEach((address) => {
        expect(isValidCosmosAddress(address)).toBe(false);
      });
    });
  });

  describe('isValidLikeAddress', () => {
    it('should validate correct Like addresses', () => {
      const validAddresses = [
        'like187290tx4vj6npyl7fdfgdvxr2n9d5qyevrgdww',
        'like154xjc0r3770jahjnjs46qrdtezqm9htpvln63y',
      ];

      validAddresses.forEach((address) => {
        expect(isValidLikeAddress(address)).toBe(true);
      });
    });

    it('should reject invalid Like addresses', () => {
      const invalidAddresses = [
        'like1', // Too short
        'like10', // Too short
        'like1z', // Too short
        'like102r0xzq7y4gj8cq6q9p8j5k5l0m5n5o8p9r0s1', // Wrong length
        'like102r0xzq7y4gj8cq6q9p8j5k5l0m5n5o8p9r0s1t12345', // Too long
        'cosmos187290tx4vj6npyl7fdfgdvxr2n9d5qyell50d4', // Wrong prefix
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1', // EVM address
        'not-an-address',
        '',
        // Note: isValidLikeAddress only validates format, not checksum
        // So addresses with invalid checksums but correct format will pass
      ];

      invalidAddresses.forEach((address) => {
        expect(isValidLikeAddress(address as any)).toBe(false);
      });
    });

    it('should reject addresses with invalid characters', () => {
      const invalidAddresses = [
        'like1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7!', // Contains '!'
        'like1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7@', // Contains '@'
        'like1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7#', // Contains '#'
        'like1vlhe3qvl8yg6t5k4m4jvqe4g5l0f0k4r5j6t7 ', // Contains space
      ];

      invalidAddresses.forEach((address) => {
        expect(isValidLikeAddress(address)).toBe(false);
      });
    });
  });

  describe('changeAddressPrefix', () => {
    it('should change Cosmos prefix to Like prefix', () => {
      const likeAddress = changeAddressPrefix(validCosmosAddress, 'like');

      expect(likeAddress).toBe(validLikeAddress);
      expect(isValidLikeAddress(likeAddress)).toBe(true);
    });

    it('should change Like prefix to Cosmos prefix', () => {
      const cosmosAddress = changeAddressPrefix(validLikeAddress, 'cosmos');

      expect(cosmosAddress).toBe(validCosmosAddress);
      expect(isValidCosmosAddress(cosmosAddress)).toBe(true);
    });

    it('should change to custom prefix', () => {
      const customAddress = changeAddressPrefix(validCosmosAddress, 'custom');

      // The prefix changes and checksum is recalculated
      expect(customAddress).toMatch(/^custom1[ac-hj-np-z02-9]{38}$/);
    });

    it('should handle multiple prefix changes', () => {
      const cosmosAddress = 'cosmos187290tx4vj6npyl7fdfgdvxr2n9d5qyell50d4';
      const likeAddress = changeAddressPrefix(cosmosAddress, 'like');
      const ethAddress = changeAddressPrefix(likeAddress, 'eth');
      const backToCosmos = changeAddressPrefix(ethAddress, 'cosmos');

      expect(backToCosmos).toBe(cosmosAddress);
    });
  });

  describe('publicKeyBinaryToAddresses', () => {
    it('should convert public key to both Cosmos and Like addresses', () => {
      // Generate a test key pair
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);

      const { cosmosAddress, likeAddress } = publicKeyBinaryToAddresses(publicKey);

      expect(cosmosAddress).toBeDefined();
      expect(likeAddress).toBeDefined();
      expect(cosmosAddress).toMatch(/^cosmos1[ac-hj-np-z02-9]{38}$/);
      expect(likeAddress).toMatch(/^like1[ac-hj-np-z02-9]{38}$/);
    });

    it('should generate different addresses for different public keys', () => {
      const privateKey1 = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr1 = secp256k1.publicKeyCreate(privateKey1, true);
      const publicKey1 = Buffer.from(publicKeyArr1);

      const privateKey2 = Buffer.from('5678000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr2 = secp256k1.publicKeyCreate(privateKey2, true);
      const publicKey2 = Buffer.from(publicKeyArr2);

      const addresses1 = publicKeyBinaryToAddresses(publicKey1);
      const addresses2 = publicKeyBinaryToAddresses(publicKey2);

      expect(addresses1.cosmosAddress).not.toBe(addresses2.cosmosAddress);
      expect(addresses1.likeAddress).not.toBe(addresses2.likeAddress);
    });

    it('should generate addresses with same data but different prefixes', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);

      const { cosmosAddress, likeAddress } = publicKeyBinaryToAddresses(publicKey);

      // Convert cosmos to like and verify they match
      const convertedLike = changeAddressPrefix(cosmosAddress, 'like');
      expect(convertedLike).toBe(likeAddress);
    });

    it('should handle compressed public keys (33 bytes)', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);

      expect(publicKey.length).toBe(33); // Compressed public key

      const { cosmosAddress, likeAddress } = publicKeyBinaryToAddresses(publicKey);

      expect(isValidCosmosAddress(cosmosAddress)).toBe(true);
      expect(isValidLikeAddress(likeAddress)).toBe(true);
    });

    it('should handle uncompressed public keys (65 bytes)', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, false);
      const publicKey = Buffer.from(publicKeyArr);

      expect(publicKey.length).toBe(65); // Uncompressed public key

      const { cosmosAddress, likeAddress } = publicKeyBinaryToAddresses(publicKey);

      expect(isValidCosmosAddress(cosmosAddress)).toBe(true);
      expect(isValidLikeAddress(likeAddress)).toBe(true);
    });
  });

  describe('verifyCosmosSignInPayload', () => {
    it('should verify valid Cosmos signature', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);
      const message = 'test message';
      const messageSha256 = createHash('sha256');
      messageSha256.update(message);
      const msgHash = messageSha256.digest();
      const { signature: signatureArr } = secp256k1.ecdsaSign(msgHash, privateKey);
      const signature = Buffer.from(signatureArr);

      const { cosmosAddress, likeAddress } = publicKeyBinaryToAddresses(publicKey);

      expect(verifyCosmosSignInPayload({
        signature: signature.toString('base64'),
        publicKey: publicKey.toString('base64'),
        message,
        inputWallet: cosmosAddress,
      })).toBe(true);

      expect(verifyCosmosSignInPayload({
        signature: signature.toString('base64'),
        publicKey: publicKey.toString('base64'),
        message,
        inputWallet: likeAddress,
      })).toBe(true);
    });

    it('should reject invalid signature', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);
      const message = 'test message';
      const { cosmosAddress } = publicKeyBinaryToAddresses(publicKey);

      // Invalid base64 signature - the secp256k1 library throws an error for invalid base64
      // So we need to test with a valid base64 but invalid signature
      // Create a 64-byte buffer with all zeros (invalid signature)
      const invalidSignature = Buffer.alloc(64, 0);
      expect(verifyCosmosSignInPayload({
        signature: invalidSignature.toString('base64'),
        publicKey: publicKey.toString('base64'),
        message,
        inputWallet: cosmosAddress,
      })).toBe(false);
    });

    it('should reject signature with wrong length', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);
      const message = 'test message';
      const { cosmosAddress } = publicKeyBinaryToAddresses(publicKey);

      // Create a signature that's too short (secp256k1 signatures are 64 bytes)
      // The secp256k1 library throws an error for wrong length
      // We need to wrap this in try-catch or test that it throws
      const shortSignature = Buffer.alloc(32);
      expect(() => {
        verifyCosmosSignInPayload({
          signature: shortSignature.toString('base64'),
          publicKey: publicKey.toString('base64'),
          message,
          inputWallet: cosmosAddress,
        });
      }).toThrow();
    });

    it('should reject mismatched wallet address', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);
      const message = 'test message';
      const messageSha256 = createHash('sha256');
      messageSha256.update(message);
      const msgHash = messageSha256.digest();
      const { signature: signatureArr } = secp256k1.ecdsaSign(msgHash, privateKey);
      const signature = Buffer.from(signatureArr);

      expect(verifyCosmosSignInPayload({
        signature: signature.toString('base64'),
        publicKey: publicKey.toString('base64'),
        message,
        inputWallet: 'cosmos1differentwalletaddress',
      })).toBe(false);
    });

    it('should reject wrong message in signature', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);
      const message = 'test message';
      const wrongMessage = 'wrong message';
      const messageSha256 = createHash('sha256');
      messageSha256.update(message);
      const msgHash = messageSha256.digest();
      const { signature: signatureArr } = secp256k1.ecdsaSign(msgHash, privateKey);
      const signature = Buffer.from(signatureArr);

      const { cosmosAddress } = publicKeyBinaryToAddresses(publicKey);

      expect(verifyCosmosSignInPayload({
        signature: signature.toString('base64'),
        publicKey: publicKey.toString('base64'),
        message: wrongMessage,
        inputWallet: cosmosAddress,
      })).toBe(false);
    });

    it('should reject wrong public key', () => {
      const privateKey = Buffer.from('1234000000000000000000000000000000000000000000000000000000000000', 'hex');
      const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
      const publicKey = Buffer.from(publicKeyArr);
      const message = 'test message';
      const messageSha256 = createHash('sha256');
      messageSha256.update(message);
      const msgHash = messageSha256.digest();
      const { signature: signatureArr } = secp256k1.ecdsaSign(msgHash, privateKey);
      const signature = Buffer.from(signatureArr);

      const { cosmosAddress } = publicKeyBinaryToAddresses(publicKey);

      // Generate a different public key
      const differentPrivateKey = Buffer.from('5678000000000000000000000000000000000000000000000000000000000000', 'hex');
      const differentPublicKeyArr = secp256k1.publicKeyCreate(differentPrivateKey, true);
      const differentPublicKey = Buffer.from(differentPublicKeyArr);

      expect(verifyCosmosSignInPayload({
        signature: signature.toString('base64'),
        publicKey: differentPublicKey.toString('base64'),
        message,
        inputWallet: cosmosAddress,
      })).toBe(false);
    });
  });

  describe('LIKE amount conversion utilities', () => {
    describe('LIKEToAmount', () => {
      it('should convert LIKE to nanoekil amount', () => {
        const result = LIKEToAmount('1');
        expect(result.amount).toBe('1000000000');
        expect(result.denom).toBeDefined();
      });

      it('should convert decimal LIKE to nanoekil amount', () => {
        const result = LIKEToAmount('1.5');
        expect(result.amount).toBe('1500000000');
      });

      it('should convert small decimal values', () => {
        const result = LIKEToAmount('0.000000001');
        expect(result.amount).toBe('1');
      });

      it('should handle large values', () => {
        const result = LIKEToAmount('1000000000');
        expect(result.amount).toBe('1000000000000000000');
      });

      it('should handle string input', () => {
        const result = LIKEToAmount('42');
        expect(result.amount).toBe('42000000000');
      });

      it('should handle zero', () => {
        const result = LIKEToAmount('0');
        expect(result.amount).toBe('0');
      });
    });

    describe('amountToLIKE', () => {
      it('should convert nanoekil to LIKE', () => {
        const result = amountToLIKE({ amount: '1000000000', denom: 'nanoekil' });
        expect(result).toBe('1');
      });

      it('should convert decimal nanoekil to LIKE', () => {
        const result = amountToLIKE({ amount: '1500000000', denom: 'nanoekil' });
        expect(result).toBe('1.5');
      });

      it('should handle small amounts', () => {
        const result = amountToLIKE({ amount: '1', denom: 'nanoekil' });
        expect(result).toBe('0.000000001');
      });

      it('should handle zero', () => {
        const result = amountToLIKE({ amount: '0', denom: 'nanoekil' });
        expect(result).toBe('0');
      });

      it('should return -1 for unsupported denom', () => {
        const result = amountToLIKE({ amount: '1000000000', denom: 'uatom' });
        expect(result).toBe(-1);
      });

      it('should handle large amounts', () => {
        const result = amountToLIKE({ amount: '1000000000000000000', denom: 'nanoekil' });
        expect(result).toBe('1000000000');
      });
    });

    describe('Round-trip conversion', () => {
      it('should maintain value through round-trip conversion', () => {
        const originalValue = '123.456789';
        const amountObj = LIKEToAmount(originalValue);
        const convertedBack = amountToLIKE(amountObj);
        expect(convertedBack).toBe(originalValue);
      });

      it('should handle various precision levels', () => {
        const testValues = ['0.000000001', '0.1', '1', '10', '100.123456789'];
        testValues.forEach((value) => {
          const amountObj = LIKEToAmount(value);
          const convertedBack = amountToLIKE(amountObj);
          expect(convertedBack).toBe(value);
        });
      });
    });
  });
});
