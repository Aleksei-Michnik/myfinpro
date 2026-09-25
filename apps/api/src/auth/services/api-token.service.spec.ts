import { createHash } from 'crypto';
import {
  API_TOKEN_MAX_ACTIVE,
  API_TOKEN_PREFIX,
  API_TOKEN_RANDOM_LENGTH,
  API_TOKEN_SCOPE_ACCOUNTS_IMPORT,
} from '@myfinpro/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiTokenService } from './api-token.service';
import { TokenService } from './token.service';

/**
 * Phase 20 · 20.7 — scoped personal access tokens (design §6.4).
 * The properties that matter: the raw value leaves the server exactly once,
 * only its hash is stored, and verify() lets nothing revoked, expired,
 * unknown or disabled through.
 */
describe('ApiTokenService', () => {
  let service: ApiTokenService;

  const mockPrisma = {
    apiToken: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };

  /** The real hash, so "the raw value is never stored" is a real assertion. */
  const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');
  const mockTokenService = { hashToken: jest.fn(sha256) };

  const activeUser = { email: 'connector@test.local', name: 'Connector', isActive: true };

  const storedToken = (overrides: Record<string, unknown> = {}) => ({
    id: 'token-1',
    userId: 'user-1',
    scopes: API_TOKEN_SCOPE_ACCOUNTS_IMPORT,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    user: activeUser,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiTokenService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
      ],
    }).compile();

    service = module.get(ApiTokenService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  describe('create()', () => {
    beforeEach(() => {
      mockPrisma.apiToken.count.mockResolvedValue(0);
      mockPrisma.apiToken.create.mockImplementation(
        ({ data }: { data: { name: string; expiresAt: Date | null } }) =>
          Promise.resolve({
            id: 'token-1',
            name: data.name,
            expiresAt: data.expiresAt,
            createdAt: new Date('2026-09-25T10:00:00Z'),
          }),
      );
    });

    it('returns the raw token once and stores only its hash', async () => {
      const result = await service.create('user-1', { name: 'Home laptop' });

      expect(result.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
      expect(result.token.slice(API_TOKEN_PREFIX.length)).toMatch(
        new RegExp(`^[A-Za-z0-9_-]{${API_TOKEN_RANDOM_LENGTH}}$`),
      );
      expect(result.scopes).toEqual([API_TOKEN_SCOPE_ACCOUNTS_IMPORT]);
      expect(result.expiresAt).toBeNull();

      const stored = mockPrisma.apiToken.create.mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(sha256(result.token));
      expect(JSON.stringify(stored)).not.toContain(result.token);
    });

    it('mints a distinct value every time', async () => {
      const first = await service.create('user-1', { name: 'One' });
      const second = await service.create('user-1', { name: 'Two' });
      expect(first.token).not.toBe(second.token);
    });

    it('writes an API_TOKEN_CREATED audit row with ids and scopes only', async () => {
      const result = await service.create('user-1', { name: 'Home laptop' });
      const audit = mockPrisma.auditLog.create.mock.calls[0][0].data;

      expect(audit).toMatchObject({
        userId: 'user-1',
        action: 'API_TOKEN_CREATED',
        entity: 'ApiToken',
        entityId: 'token-1',
      });
      expect(JSON.stringify(audit)).not.toContain(result.token);
    });

    it('rejects a new token once the active cap is reached', async () => {
      mockPrisma.apiToken.count.mockResolvedValue(API_TOKEN_MAX_ACTIVE);

      await expect(service.create('user-1', { name: 'Eleventh' })).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.apiToken.create).not.toHaveBeenCalled();
    });

    it('counts only live tokens against the cap', async () => {
      await service.create('user-1', { name: 'Home laptop' });
      expect(mockPrisma.apiToken.count.mock.calls[0][0].where).toMatchObject({
        userId: 'user-1',
        revokedAt: null,
      });
    });
  });

  describe('list()', () => {
    it('returns metadata without a secret', async () => {
      mockPrisma.apiToken.findMany.mockResolvedValue([
        {
          id: 'token-1',
          name: 'Home laptop',
          scopes: `${API_TOKEN_SCOPE_ACCOUNTS_IMPORT},bogus:scope`,
          lastUsedAt: new Date('2026-09-25T09:00:00Z'),
          expiresAt: null,
          createdAt: new Date('2026-09-20T09:00:00Z'),
        },
      ]);

      const [token] = await service.list('user-1');

      expect(token).toEqual({
        id: 'token-1',
        name: 'Home laptop',
        scopes: [API_TOKEN_SCOPE_ACCOUNTS_IMPORT],
        lastUsedAt: '2026-09-25T09:00:00.000Z',
        expiresAt: null,
        createdAt: '2026-09-20T09:00:00.000Z',
      });
      expect(mockPrisma.apiToken.findMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        revokedAt: null,
      });
    });
  });

  describe('revoke()', () => {
    it('revokes the caller’s own token and audits it', async () => {
      mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 1 });

      await service.revoke('user-1', 'token-1');

      expect(mockPrisma.apiToken.updateMany.mock.calls[0][0].where).toEqual({
        id: 'token-1',
        userId: 'user-1',
        revokedAt: null,
      });
      expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'API_TOKEN_REVOKED',
        entityId: 'token-1',
      });
    });

    it('404s for a token that is not the caller’s', async () => {
      mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.revoke('user-1', 'token-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('verify()', () => {
    const raw = `${API_TOKEN_PREFIX}abcdefghijklmnopqrstuvwxyz0123456789ABCD`;

    it('resolves owner, scopes and identity for a live token', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(storedToken());
      mockPrisma.apiToken.update.mockResolvedValue({});

      await expect(service.verify(raw)).resolves.toEqual({
        tokenId: 'token-1',
        userId: 'user-1',
        scopes: [API_TOKEN_SCOPE_ACCOUNTS_IMPORT],
        email: activeUser.email,
        name: activeUser.name,
      });
      expect(mockPrisma.apiToken.findUnique.mock.calls[0][0].where).toEqual({
        tokenHash: sha256(raw),
      });
    });

    it('does not look up a value that is not one of ours', async () => {
      await expect(service.verify('eyJhbGciOiJIUzI1NiJ9.payload.sig')).resolves.toBeNull();
      expect(mockPrisma.apiToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an unknown token', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(null);
      await expect(service.verify(raw)).resolves.toBeNull();
    });

    it('rejects a revoked token', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(
        storedToken({ revokedAt: new Date('2026-09-24T00:00:00Z') }),
      );
      await expect(service.verify(raw)).resolves.toBeNull();
    });

    it('rejects an expired token', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(
        storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.verify(raw)).resolves.toBeNull();
    });

    it('rejects a token whose account is disabled', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(
        storedToken({ user: { ...activeUser, isActive: false } }),
      );
      await expect(service.verify(raw)).resolves.toBeNull();
    });

    it('stamps lastUsedAt at most once a minute', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(
        storedToken({ lastUsedAt: new Date(Date.now() - 5_000) }),
      );
      await service.verify(raw);
      expect(mockPrisma.apiToken.update).not.toHaveBeenCalled();

      mockPrisma.apiToken.findUnique.mockResolvedValue(
        storedToken({ lastUsedAt: new Date(Date.now() - 120_000) }),
      );
      mockPrisma.apiToken.update.mockResolvedValue({});
      await service.verify(raw);
      expect(mockPrisma.apiToken.update).toHaveBeenCalledTimes(1);
    });

    it('still authenticates when the lastUsedAt stamp fails', async () => {
      mockPrisma.apiToken.findUnique.mockResolvedValue(storedToken());
      mockPrisma.apiToken.update.mockRejectedValue(new Error('db down'));
      await expect(service.verify(raw)).resolves.toMatchObject({ userId: 'user-1' });
    });
  });
});
