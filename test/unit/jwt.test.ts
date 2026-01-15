import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  jwtSign,
  jwtVerify,
  getToken,
  getProviderJWTSecret,
  jwtSignForAZP,
  defaultVerifySecret,
  defaultVerifyAlgorithm,
} from '../../src/util/jwt';

describe('JWT Utility Unit Tests', () => {
  describe('getToken', () => {
    it('should extract token from Bearer authorization header', () => {
      const req = {
        headers: {
          authorization: 'Bearer my-token',
        },
        cookies: {},
        query: {},
      } as any;

      const token = getToken(req);
      expect(token).toBe('my-token');
    });

    it('should extract token from likecoin_auth cookie', () => {
      const req = {
        headers: {},
        cookies: {
          likecoin_auth: 'cookie-token',
        },
        query: {},
      } as any;

      const token = getToken(req);
      expect(token).toBe('cookie-token');
    });

    it('should extract token from likecoin_button_auth cookie', () => {
      const req = {
        headers: {},
        cookies: {
          likecoin_button_auth: 'button-token',
        },
        query: {},
      } as any;

      const token = getToken(req);
      expect(token).toBe('button-token');
    });

    it('should prioritize likecoin_auth over button cookie', () => {
      const req = {
        headers: {},
        cookies: {
          likecoin_auth: 'auth-token',
          likecoin_button_auth: 'button-token',
        },
        query: {},
      } as any;

      const token = getToken(req);
      expect(token).toBe('auth-token');
    });

    it('should extract token from query parameter', () => {
      const req = {
        headers: {},
        cookies: {},
        query: {
          access_token: 'query-token',
        },
      } as any;

      const token = getToken(req);
      expect(token).toBe('query-token');
    });

    it('should prioritize authorization header over others', () => {
      const req = {
        headers: {
          authorization: 'Bearer header-token',
        },
        cookies: {
          likecoin_auth: 'cookie-token',
        },
        query: {
          access_token: 'query-token',
        },
      } as any;

      const token = getToken(req);
      expect(token).toBe('header-token');
    });

    it('should return empty string when no token found', () => {
      const req = {
        headers: {},
        cookies: {},
        query: {},
      } as any;

      const token = getToken(req);
      expect(token).toBe('');
    });

    it('should NOT handle lowercase bearer authorization header (only uppercase Bearer)', () => {
      const req = {
        headers: {
          authorization: 'bearer my-token',
        },
        cookies: {},
        query: {},
      } as any;

      const token = getToken(req);
      // getToken only checks for uppercase 'Bearer', not lowercase
      expect(token).not.toBe('my-token');
      // Since lowercase 'bearer' is not recognized, it returns empty string
      expect(token).toBe('');
    });

    it('should NOT handle uppercase bearer authorization header (only exact "Bearer" works)', () => {
      const req = {
        headers: {
          authorization: 'BEARER my-token',
        },
        cookies: {},
        query: {},
      } as any;

      const token = getToken(req);
      // getToken uses strict equality for 'Bearer', so BEARER doesn't match
      expect(token).not.toBe('my-token');
      expect(token).toBe('');
    });

    it('should handle missing authorization header parts (Bearer with no token)', () => {
      const req = {
        headers: {
          authorization: 'Bearer', // No token after
        },
        cookies: {},
        query: {},
      } as any;

      const token = getToken(req);
      // When there's only 'Bearer' with no token after, split returns ['Bearer']
      // and split(' ')[1] is undefined
      expect(token).toBeUndefined();
    });
  });

  describe('jwtSign and jwtVerify', () => {
    it('should sign and verify JWT token successfully', () => {
      const payload = {
        user: 'test-user',
        wallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
        permissions: ['read', 'write'],
      };

      const { token, jwtid, exp } = jwtSign(payload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(jwtid).toBeDefined();
      expect(typeof jwtid).toBe('string');
      expect(exp).toBeDefined();

      // Verify the token
      const decoded = jwtVerify(token) as any;
      expect(decoded.user).toBe(payload.user);
      expect(decoded.wallet).toBe(payload.wallet);
      expect(decoded.permissions).toEqual(payload.permissions);
      expect(decoded.jti).toBe(jwtid);
    });

    it('should include default expiration if not specified', () => {
      const payload = { user: 'test-user' };
      const { token, exp } = jwtSign(payload);

      const decoded = jwt.decode(token) as any;
      expect(decoded.exp).toBe(exp);
      expect(decoded.exp).toBeDefined();
    });

    it('should allow custom expiration', () => {
      const payload = { user: 'test-user' };
      const { token } = jwtSign(payload, { expiresIn: '1h' });

      const decoded = jwt.decode(token) as any;
      const now = Math.floor(Date.now() / 1000);
      const expirationTime = decoded.exp - now;

      // Should be approximately 1 hour (3600 seconds)
      expect(expirationTime).toBeGreaterThan(3500);
      expect(expirationTime).toBeLessThan(3700);
    });

    it('should include issuer and audience', () => {
      const payload = { user: 'test-user' };
      const { token } = jwtSign(payload);

      const decoded = jwt.decode(token) as any;
      expect(decoded.iss).toBeDefined();
      expect(decoded.aud).toBeDefined();
    });

    it('should include jwtid in token', () => {
      const payload = { user: 'test-user' };
      const { token, jwtid } = jwtSign(payload);

      const decoded = jwt.decode(token) as any;
      expect(decoded.jti).toBe(jwtid);
    });

    it('should verify token with custom options', () => {
      const payload = { user: 'test-user' };
      const { token } = jwtSign(payload);

      // Verify with ignoreExpiration
      const decoded = jwtVerify(token, defaultVerifySecret, { ignoreExpiration: true }) as any;
      expect(decoded.user).toBe(payload.user);
    });

    it('should verify token with custom audience', () => {
      const customAudience = 'custom-audience';
      const payload = { user: 'test-user' };
      const { token } = jwtSign(payload, { audience: customAudience });

      const decoded = jwtVerify(token, defaultVerifySecret, { audience: customAudience }) as any;
      expect(decoded.user).toBe(payload.user);
    });

    it('should generate unique jwtid for each signing', () => {
      const payload = { user: 'test-user' };

      const { jwtid: jwtid1 } = jwtSign(payload);
      const { jwtid: jwtid2 } = jwtSign(payload);
      const { jwtid: jwtid3 } = jwtSign(payload);

      expect(jwtid1).not.toBe(jwtid2);
      expect(jwtid2).not.toBe(jwtid3);
      expect(jwtid1).not.toBe(jwtid3);
    });

    it('should handle complex permissions', () => {
      const payload = {
        user: 'test-user',
        permissions: ['read', 'write', 'admin'],
      };
      const { token } = jwtSign(payload);

      const decoded = jwtVerify(token) as any;
      expect(decoded.permissions).toEqual(payload.permissions);
    });

    it('should handle empty permissions array', () => {
      const payload = {
        user: 'test-user',
        permissions: [],
      };
      const { token } = jwtSign(payload);

      const decoded = jwtVerify(token) as any;
      expect(decoded.permissions).toEqual([]);
    });
  });

  describe('getProviderJWTSecret', () => {
    it('should generate HMAC SHA256 hash of client secret', () => {
      const clientSecret = 'my-client-secret';
      const hash = getProviderJWTSecret(clientSecret);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA256 hex output is 64 characters
    });

    it('should generate same hash for same input', () => {
      const clientSecret = 'my-client-secret';
      const hash1 = getProviderJWTSecret(clientSecret);
      const hash2 = getProviderJWTSecret(clientSecret);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = getProviderJWTSecret('secret1');
      const hash2 = getProviderJWTSecret('secret2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = getProviderJWTSecret('');
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should handle special characters', () => {
      const clientSecret = 'secret-with-special-chars-!@#$%^&*()';
      const hash = getProviderJWTSecret(clientSecret);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    it('should handle unicode characters', () => {
      const clientSecret = 'secret-with-unicode-中文-😀';
      const hash = getProviderJWTSecret(clientSecret);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });
  });

  describe('jwtSignForAZP', () => {
    it('should sign token with azp claim', () => {
      const payload = { user: 'test-user' };
      const secret = 'provider-secret';
      const hashedSecret = getProviderJWTSecret(secret);
      const azp = 'client-123';

      const { token } = jwtSignForAZP(payload, hashedSecret, { azp });

      const decoded = jwt.decode(token) as any;
      expect(decoded.azp).toBe(azp);
      expect(decoded.user).toBe(payload.user);
    });

    it('should use HS256 algorithm for azp tokens', () => {
      const payload = { user: 'test-user' };
      const secret = 'provider-secret';
      const hashedSecret = getProviderJWTSecret(secret);

      const { token } = jwtSignForAZP(payload, hashedSecret);

      const decoded = jwt.decode(token, { complete: true }) as any;
      expect(decoded.header.alg).toBe('HS256');
    });

    it('should verify azp token with provider secret', () => {
      const payload = { user: 'test-user' };
      const secret = 'provider-secret';
      const hashedSecret = getProviderJWTSecret(secret);
      const azp = 'client-123';

      const { token } = jwtSignForAZP(payload, hashedSecret, { azp });

      // Verify with the same hashed secret
      const decoded = jwt.verify(token, hashedSecret, { algorithms: ['HS256'] }) as any;
      expect(decoded.user).toBe(payload.user);
      expect(decoded.azp).toBe(azp);
    });

    it('should set custom expiration for azp token', () => {
      const payload = { user: 'test-user' };
      const secret = 'provider-secret';
      const hashedSecret = getProviderJWTSecret(secret);

      const { token } = jwtSignForAZP(payload, hashedSecret, { expiresIn: '2h' });

      const decoded = jwt.decode(token) as any;
      const now = Math.floor(Date.now() / 1000);
      const expirationTime = decoded.exp - now;

      // Should be approximately 2 hours (7200 seconds)
      expect(expirationTime).toBeGreaterThan(7100);
      expect(expirationTime).toBeLessThan(7300);
    });

    it('should default to 1 hour expiration for azp token', () => {
      const payload = { user: 'test-user' };
      const secret = 'provider-secret';
      const hashedSecret = getProviderJWTSecret(secret);

      const { token } = jwtSignForAZP(payload, hashedSecret);

      const decoded = jwt.decode(token) as any;
      const now = Math.floor(Date.now() / 1000);
      const expirationTime = decoded.exp - now;

      // Should be approximately 1 hour (3600 seconds)
      expect(expirationTime).toBeGreaterThan(3500);
      expect(expirationTime).toBeLessThan(3700);
    });
  });

  describe('Error Handling', () => {
    it('should throw when verifying invalid token', () => {
      const invalidToken = 'invalid.token.string';

      expect(() => {
        jwtVerify(invalidToken);
      }).toThrow();
    });

    it('should throw when verifying tampered token', () => {
      const payload = { user: 'test-user' };
      const { token } = jwtSign(payload);

      // Tamper with the token
      const tamperedToken = `${token.slice(0, -5)}aaaaa`;

      expect(() => {
        jwtVerify(tamperedToken);
      }).toThrow();
    });

    it('should throw when verifying with wrong secret', () => {
      const payload = { user: 'test-user' };
      const { token } = jwtSign(payload);

      expect(() => {
        jwt.verify(token, 'wrong-secret', { algorithms: [defaultVerifyAlgorithm] });
      }).toThrow();
    });
  });

  describe('Token Payload Edge Cases', () => {
    it('should handle empty payload', () => {
      const payload = {};
      const { token } = jwtSign(payload);

      const decoded = jwtVerify(token) as any;
      expect(decoded).toBeDefined();
    });

    it('should handle payload with special characters', () => {
      const payload = {
        user: 'user-with-特殊字符-😀',
        displayName: 'Display "Name" with \'quotes\'',
      };
      const { token } = jwtSign(payload);

      const decoded = jwtVerify(token) as any;
      expect(decoded.user).toBe(payload.user);
      expect(decoded.displayName).toBe(payload.displayName);
    });

    it('should handle payload with nested objects', () => {
      const payload = {
        user: 'test-user',
        metadata: {
          locale: 'en-US',
          theme: 'dark',
          preferences: {
            notifications: true,
          },
        },
      };
      const { token } = jwtSign(payload);

      const decoded = jwtVerify(token) as any;
      expect(decoded.metadata).toEqual(payload.metadata);
    });

    it('should handle payload with array values', () => {
      const payload = {
        user: 'test-user',
        roles: ['admin', 'moderator', 'user'],
        walletAddresses: ['0x123', '0x456'],
      };
      const { token } = jwtSign(payload);

      const decoded = jwtVerify(token) as any;
      expect(decoded.roles).toEqual(payload.roles);
      expect(decoded.walletAddresses).toEqual(payload.walletAddresses);
    });
  });
});
