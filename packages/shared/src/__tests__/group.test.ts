import { describe, it, expect } from 'vitest';
import {
  GROUP_TYPES,
  GROUP_ROLES,
  INVITE_TOKEN_EXPIRY_DAYS,
  type GroupType,
  type GroupRole,
} from '../types/group.types';

describe('Group Types', () => {
  describe('GROUP_TYPES', () => {
    it('should contain "family"', () => {
      expect(GROUP_TYPES).toContain('family');
    });

    it('should be a readonly tuple (frozen at type level)', () => {
      const values: readonly string[] = GROUP_TYPES;
      expect(values.length).toBeGreaterThan(0);
    });

    it('should allow assignment to GroupType', () => {
      const t: GroupType = 'family';
      expect(GROUP_TYPES).toContain(t);
    });
  });

  describe('GROUP_ROLES', () => {
    it('should contain "admin" and "member"', () => {
      expect(GROUP_ROLES).toContain('admin');
      expect(GROUP_ROLES).toContain('member');
    });

    it('should have exactly two roles', () => {
      expect(GROUP_ROLES).toHaveLength(2);
    });

    it('should allow assignment to GroupRole', () => {
      const admin: GroupRole = 'admin';
      const member: GroupRole = 'member';
      expect(GROUP_ROLES).toContain(admin);
      expect(GROUP_ROLES).toContain(member);
    });
  });

  describe('INVITE_TOKEN_EXPIRY_DAYS', () => {
    it('should be a positive number', () => {
      expect(INVITE_TOKEN_EXPIRY_DAYS).toBeGreaterThan(0);
    });

    it('should equal 7 days', () => {
      expect(INVITE_TOKEN_EXPIRY_DAYS).toBe(7);
    });
  });
});
