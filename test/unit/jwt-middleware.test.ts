import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { expandScope, expandScopeGroup } from '../../src/middleware/jwt';

// Mock the permission groups
vi.mock('../../src/constant/jwt', () => ({
  PERMISSION_GROUPS: {
    civicliker: ['read:civicliker', 'write:civicliker'],
    user: ['read:user', 'write:user'],
    all: ['read', 'write'],
  },
}));

describe('JWT Middleware Unit Tests', () => {
  describe('expandScopeGroup', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should expand known scope groups', async () => {
      const { PERMISSION_GROUPS } = await import('../../src/constant/jwt');
      const civicLikerScopes = expandScopeGroup('civicliker');
      expect(civicLikerScopes).toEqual(PERMISSION_GROUPS.civicliker);
    });

    it('should return array with single scope for unknown groups', () => {
      const result = expandScopeGroup('unknown-group');
      expect(result).toEqual(['unknown-group']);
    });

    it('should handle empty string', () => {
      const result = expandScopeGroup('');
      expect(result).toEqual(['']);
    });

    it('should not modify the original permission groups', async () => {
      const { PERMISSION_GROUPS } = await import('../../src/constant/jwt');
      const originalGroups = JSON.parse(JSON.stringify(PERMISSION_GROUPS));

      expandScopeGroup('civicliker');
      expandScopeGroup('user');

      expect(PERMISSION_GROUPS).toEqual(originalGroups);
    });
  });

  describe('expandScope', () => {
    it('should return single scope for simple permission', () => {
      const result = expandScope('read');
      expect(result).toEqual(['read']);
    });

    it('should return single scope for scope without colon', () => {
      const result = expandScope('user');
      expect(result).toEqual(['user']);
    });

    it('should expand scope with single colon', () => {
      const result = expandScope('read:user');
      expect(result).toEqual(['read', 'read:user']);
    });

    it('should expand scope with multiple nested levels', () => {
      const result = expandScope('read:like.info');
      expect(result).toEqual(['read', 'read:like', 'read:like.info']);
    });

    it('should expand scope with deeply nested levels', () => {
      const result = expandScope('write:api.users.settings');
      expect(result).toEqual([
        'write',
        'write:api',
        'write:api.users',
        'write:api.users.settings',
      ]);
    });

    it('should handle scope with three dots (four levels)', () => {
      const result = expandScope('read:a.b.c.d');
      expect(result).toEqual([
        'read',
        'read:a',
        'read:a.b',
        'read:a.b.c',
        'read:a.b.c.d',
      ]);
    });

    it('should handle scope with trailing colon', () => {
      const result = expandScope('read:');
      expect(result).toEqual(['read', 'read:']);
    });

    it('should handle scope with leading colon', () => {
      const result = expandScope(':user');
      // With leading colon, split(':') gives ['', 'user']
      // So permission = '', scopesString = 'user'
      // Result is ['', ':user']
      expect(result).toEqual(['', ':user']);
    });

    it('should handle scope with multiple consecutive colons', () => {
      const result = expandScope('read::user');
      // Splitting on ':' gives ['read', '', 'user']
      // But the code only takes first two: permission='read', scopesString=''
      // scopesString.split('.') gives ['']
      // Result is ['read', 'read:']
      expect(result).toEqual(['read', 'read:']);
    });

    it('should handle single word with colon', () => {
      const result = expandScope('admin:');
      expect(result).toEqual(['admin', 'admin:']);
    });

    it('should handle numeric scope parts', () => {
      const result = expandScope('read:api.v2.users');
      expect(result).toEqual([
        'read',
        'read:api',
        'read:api.v2',
        'read:api.v2.users',
      ]);
    });

    it('should handle special characters in scope parts', () => {
      const result = expandScope('read:api_v2.user-settings');
      expect(result).toEqual([
        'read',
        'read:api_v2',
        'read:api_v2.user-settings',
      ]);
    });

    it('should preserve the exact order of expanded scopes', () => {
      const result = expandScope('write:a.b.c');
      // Tracing through the code:
      // parsed = ['write', 'a.b.c']
      // scopes = ['a', 'b', 'c']
      // list starts as ['write', 'write:a']
      // Then adds 'write:a.b', then 'write:a.b.c'
      expect(result).toEqual(['write', 'write:a', 'write:a.b', 'write:a.b.c']);
    });
  });

  describe('Scope expansion edge cases', () => {
    it('should handle very long scope paths', () => {
      const longScope = 'read:a.b.c.d.e.f.g';
      const result = expandScope(longScope);
      expect(result).toHaveLength(8); // base permission + 7 levels
      expect(result[0]).toBe('read');
      expect(result[result.length - 1]).toBe(longScope);
    });

    it('should handle scope with single character parts', () => {
      const result = expandScope('r:a.b.c');
      expect(result).toEqual(['r', 'r:a', 'r:a.b', 'r:a.b.c']);
    });

    it('should handle scope with underscore', () => {
      const result = expandScope('read:user_info');
      expect(result).toEqual(['read', 'read:user_info']);
    });

    it('should handle scope with hyphen', () => {
      const result = expandScope('read:user-info');
      expect(result).toEqual(['read', 'read:user-info']);
    });

    it('should handle scope with mixed separators', () => {
      const result = expandScope('read:user_info.settings-detail');
      expect(result).toEqual([
        'read',
        'read:user_info',
        'read:user_info.settings-detail',
      ]);
    });
  });

  describe('Permission matching scenarios', () => {
    it('should match exact permission', () => {
      const userScopes = expandScope('read:user');
      const requiredScope = 'read:user';
      const requiredScopes = expandScope(requiredScope);

      const hasPermission = requiredScopes.some((scope) => userScopes.includes(scope));
      expect(hasPermission).toBe(true);
    });

    it('should match parent permission', () => {
      const userScopes = expandScope('read:user');
      const requiredScope = 'read:user.settings';
      const requiredScopes = expandScope(requiredScope);

      // User has read:user, which should grant read:user.settings
      const hasPermission = requiredScopes.some((scope) => userScopes.includes(scope));
      expect(hasPermission).toBe(true);
    });

    it('should not match unrelated permission', () => {
      const userScopes = expandScope('read:user');
      const requiredScope = 'write:user';
      const requiredScopes = expandScope(requiredScope);

      const hasPermission = requiredScopes.some((scope) => userScopes.includes(scope));
      expect(hasPermission).toBe(false);
    });

    it('should not match different resource', () => {
      const userScopes = expandScope('read:user');
      const requiredScope = 'write:post';
      const requiredScopes = expandScope(requiredScope);

      // User has ['read', 'read:user'], required is ['write', 'write:post']
      // There's no overlap, so should be false
      const hasPermission = requiredScopes.some((scope) => userScopes.includes(scope));
      expect(hasPermission).toBe(false);
    });

    it('should match base read permission for any resource', () => {
      const userScopes = ['read'];
      const requiredScope = 'read:any.resource.here';
      const requiredScopes = expandScope(requiredScope);

      const hasPermission = requiredScopes.some((scope) => userScopes.includes(scope));
      expect(hasPermission).toBe(true);
    });

    it('should match specific permission when user has broader access', () => {
      const userScopes = ['read', 'write'];
      const requiredScope = 'read:api.users';
      const requiredScopes = expandScope(requiredScope);

      const hasPermission = requiredScopes.some((scope) => userScopes.includes(scope));
      expect(hasPermission).toBe(true);
    });

    it('should handle multiple user scopes', () => {
      const userScopes = ['read:user', 'write:post', 'admin'];
      const testCases = [
        { scope: 'read:user', expected: true },
        { scope: 'read:user.settings', expected: true },
        { scope: 'write:post', expected: true },
        { scope: 'write:post.comment', expected: true },
        { scope: 'admin', expected: true },
        { scope: 'read:post', expected: false },
        { scope: 'write:user', expected: false },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });
  });

  describe('Real-world permission scenarios', () => {
    it('should handle civic liker permissions', () => {
      const userScopes = ['read:civicliker', 'write:civicliker'];
      const testCases = [
        { scope: 'read:civicliker', expected: true },
        { scope: 'write:civicliker', expected: true },
        { scope: 'read:civicliker.status', expected: true },
        { scope: 'read:user', expected: false },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });

    it('should handle admin with full access', () => {
      const userScopes = ['read', 'write'];
      const testCases = [
        { scope: 'read', expected: true },
        { scope: 'write', expected: true },
        { scope: 'read:user', expected: true },
        { scope: 'write:user', expected: true },
        { scope: 'read:api.users.settings', expected: true },
        { scope: 'write:api.nft.mint', expected: true },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });

    it('should handle read-only user', () => {
      const userScopes = ['read'];
      const testCases = [
        { scope: 'read', expected: true },
        { scope: 'read:user', expected: true },
        { scope: 'read:api.nft', expected: true },
        { scope: 'write:user', expected: false },
        { scope: 'write', expected: false },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });

    it('should handle limited API access', () => {
      const userScopes = ['read:api.users', 'write:api.users'];
      const testCases = [
        { scope: 'read:api.users', expected: true },
        { scope: 'read:api.users.settings', expected: true },
        { scope: 'write:api.users', expected: true },
        { scope: 'write:api.users.settings', expected: true },
        { scope: 'read:api', expected: false }, // 'read' and 'read:api' are NOT in ['read:api.users', 'write:api.users']
        { scope: 'read', expected: false }, // 'read' is NOT in ['read:api.users', 'write:api.users']
        { scope: 'read:api.posts', expected: false },
        { scope: 'write:api.posts', expected: false },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });

    it('should handle service account with multiple services', () => {
      const userScopes = [
        'read:user',
        'write:user',
        'read:nft',
        'write:nft',
        'read:civicliker',
      ];
      const testCases = [
        { scope: 'read:user', expected: true },
        { scope: 'write:user', expected: true },
        { scope: 'read:user.avatar', expected: true },
        { scope: 'read:nft', expected: true },
        { scope: 'write:nft.mint', expected: true },
        { scope: 'read:civicliker', expected: true },
        { scope: 'write:civicliker', expected: false },
        { scope: 'read:api', expected: false },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });
  });

  describe('Scope group expansion with permission scenarios', () => {
    it('should expand civicliker group and match permissions', async () => {
      const { PERMISSION_GROUPS } = await import('../../src/constant/jwt');
      const userScopes = expandScopeGroup('civicliker');

      expect(userScopes).toEqual(PERMISSION_GROUPS.civicliker);

      const testCases = [
        { scope: 'read:civicliker', expected: true },
        { scope: 'write:civicliker', expected: true },
        { scope: 'read:user', expected: false },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });

    it('should expand user group and match permissions', async () => {
      const { PERMISSION_GROUPS } = await import('../../src/constant/jwt');
      const userScopes = expandScopeGroup('user');

      expect(userScopes).toEqual(PERMISSION_GROUPS.user);

      const testCases = [
        { scope: 'read:user', expected: true },
        { scope: 'write:user', expected: true },
        { scope: 'read:civicliker', expected: false },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });

    it('should expand all group and match all permissions', async () => {
      const { PERMISSION_GROUPS } = await import('../../src/constant/jwt');
      const userScopes = expandScopeGroup('all');

      expect(userScopes).toEqual(PERMISSION_GROUPS.all);

      const testCases = [
        { scope: 'read', expected: true },
        { scope: 'write', expected: true },
        { scope: 'read:anything', expected: true },
        { scope: 'write:anything', expected: true },
      ];

      testCases.forEach(({ scope, expected }) => {
        const requiredScopes = expandScope(scope);
        const hasPermission = requiredScopes.some((s) => userScopes.includes(s));
        expect(hasPermission).toBe(expected);
      });
    });
  });
});
