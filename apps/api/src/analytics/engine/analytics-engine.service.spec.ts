import { encodeCursor } from '@myfinpro/shared';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ANALYTICS_ERRORS } from '../constants/analytics-errors';
import type { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { AnalyticsEngineService } from './analytics-engine.service';
import { queryFingerprint } from './query-fingerprint';

describe('AnalyticsEngineService', () => {
  let service: AnalyticsEngineService;

  const prisma = {
    $queryRaw: jest.fn(),
    user: { findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    groupMembership: { findMany: jest.fn() },
    category: { findMany: jest.fn() },
    merchant: { findMany: jest.fn() },
    product: { findMany: jest.fn() },
    group: { findMany: jest.fn() },
  };

  /** Assert the promise rejects with a Nest exception carrying `errorCode`. */
  async function expectError(
    p: Promise<unknown>,
    cls: new (...args: never[]) => Error,
    errorCode: string,
  ): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(cls);
    await p.catch((e) => {
      expect((e.getResponse() as { errorCode?: string }).errorCode).toBe(errorCode);
    });
  }

  const query = (over: Partial<AnalyticsQueryDto> = {}): AnalyticsQueryDto =>
    ({ dimensions: [], ...over }) as AnalyticsQueryDto;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'UTC', defaultCurrency: 'USD' });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.category.findMany.mockResolvedValue([]);
    prisma.merchant.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.group.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsEngineService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AnalyticsEngineService);
  });

  describe('semantic validation', () => {
    it("rejects 'period' without granularity", async () => {
      await expectError(
        service.runQuery('u1', query({ dimensions: ['period'] })),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      );
    });

    it("rejects granularity without 'period'", async () => {
      await expectError(
        service.runQuery('u1', query({ dimensions: ['category'], granularity: 'month' })),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      );
    });

    it("rejects 'scope' combined with 'group'", async () => {
      await expectError(
        service.runQuery('u1', query({ dimensions: ['scope', 'group'] })),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      );
    });

    it('rejects dateFrom ≥ dateTo', async () => {
      await expectError(
        service.runQuery(
          'u1',
          query({
            filters: { dateFrom: '2026-07-01T00:00:00Z', dateTo: '2026-06-01T00:00:00Z' },
          }),
        ),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      );
    });

    it('rejects malformed scope filter entries', async () => {
      await expectError(
        service.runQuery('u1', query({ filters: { scopes: [{ scope: 'group' }] } })),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      );
      await expectError(
        service.runQuery(
          'u1',
          query({ filters: { scopes: [{ scope: 'personal', groupId: 'g1' }] } }),
        ),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      );
    });

    it('403s a group scope the caller is not a member of', async () => {
      prisma.groupMembership.findMany.mockResolvedValue([]);
      await expectError(
        service.runQuery(
          'u1',
          query({ filters: { scopes: [{ scope: 'group', groupId: 'g-other' }] } }),
        ),
        ForbiddenException,
        ANALYTICS_ERRORS.ANALYTICS_SCOPE_FORBIDDEN,
      );
    });
  });

  describe('cursor handling', () => {
    it('rejects a malformed cursor', async () => {
      await expectError(
        service.runQuery('u1', query({ cursor: '%%%not-base64%%%' })),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_CURSOR,
      );
    });

    it('rejects a cursor from a different query', async () => {
      const cursor = encodeCursor({ o: 20, f: 'fingerprint-of-something-else' });
      await expectError(
        service.runQuery('u1', query({ dimensions: ['category'], cursor })),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_CURSOR,
      );
    });

    it('rejects a window past the group cap', async () => {
      const dto = query({ dimensions: ['product'], limit: 100 });
      const cursor = encodeCursor({ o: 450, f: queryFingerprint({ ...dto }) });
      await expectError(
        service.runQuery('u1', { ...dto, cursor }),
        BadRequestException,
        ANALYTICS_ERRORS.ANALYTICS_INVALID_QUERY,
      );
    });
  });

  describe('row mapping', () => {
    it('maps raw buckets: BigInt metrics, name resolution, null buckets', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          k_category: 'c1',
          currency: 'USD',
          spend_cents: 64000n,
          transaction_count: 3n,
          item_count: 2n,
        },
        {
          k_category: null,
          currency: 'EUR',
          spend_cents: 3000n,
          transaction_count: 1n,
          item_count: 0n,
        },
      ]);
      prisma.category.findMany.mockResolvedValue([{ id: 'c1', name: 'Food' }]);

      const res = await service.runQuery('u1', query({ dimensions: ['category'] }));

      expect(res.data).toEqual([
        {
          keys: { category: { id: 'c1', name: 'Food' } },
          currency: 'USD',
          spendCents: 64000,
          transactionCount: 3,
          itemCount: 2,
        },
        {
          keys: { category: { id: null, name: null } },
          currency: 'EUR',
          spendCents: 3000,
          transactionCount: 1,
          itemCount: 0,
        },
      ]);
      expect(res.hasMore).toBe(false);
      expect(res.cursor).toBeNull();
      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['c1'] } },
        select: { id: true, name: true },
      });
    });

    it('maps scope buckets to personal / group keys', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          k_scope_type: 'personal',
          k_scope_group: null,
          currency: 'USD',
          spend_cents: 100n,
          transaction_count: 1n,
          item_count: 0n,
        },
        {
          k_scope_type: 'group',
          k_scope_group: 'g1',
          currency: 'USD',
          spend_cents: 200n,
          transaction_count: 1n,
          item_count: 0n,
        },
      ]);
      prisma.group.findMany.mockResolvedValue([{ id: 'g1', name: 'Family' }]);

      const res = await service.runQuery('u1', query({ dimensions: ['scope'] }));

      expect(res.data[0].keys.scope).toEqual({ scopeType: 'personal' });
      expect(res.data[1].keys.scope).toEqual({
        scopeType: 'group',
        group: { id: 'g1', name: 'Family' },
      });
    });

    it('emits a fingerprinted offset cursor when a page overflows', async () => {
      const dto = query({ dimensions: ['category'], limit: 1 });
      prisma.$queryRaw.mockResolvedValue([
        {
          k_category: 'c1',
          currency: 'USD',
          spend_cents: 2n,
          transaction_count: 1n,
          item_count: 0n,
        },
        {
          k_category: 'c2',
          currency: 'USD',
          spend_cents: 1n,
          transaction_count: 1n,
          item_count: 0n,
        },
      ]);
      prisma.category.findMany.mockResolvedValue([{ id: 'c1', name: 'A' }]);

      const res = await service.runQuery('u1', dto);

      expect(res.data).toHaveLength(1);
      expect(res.hasMore).toBe(true);
      expect(res.cursor).not.toBeNull();
      // The emitted cursor must round-trip into the follow-up query.
      prisma.$queryRaw.mockResolvedValue([
        {
          k_category: 'c2',
          currency: 'USD',
          spend_cents: 1n,
          transaction_count: 1n,
          item_count: 0n,
        },
      ]);
      const page2 = await service.runQuery('u1', { ...dto, cursor: res.cursor! });
      expect(page2.hasMore).toBe(false);
    });
  });
});
