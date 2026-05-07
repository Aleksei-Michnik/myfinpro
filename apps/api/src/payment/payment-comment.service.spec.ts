import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import {
  decodeCommentCursor,
  encodeCommentCursor,
  PaymentCommentService,
} from './payment-comment.service';
import { PaymentService } from './payment.service';

describe('PaymentCommentService', () => {
  let service: PaymentCommentService;

  const prisma = {
    paymentComment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const paymentService = { assertVisible: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentCommentService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentService, useValue: paymentService },
      ],
    }).compile();
    service = mod.get(PaymentCommentService);
  });

  const now = new Date('2026-05-01T10:00:00.000Z');
  const row = (over: Partial<{ id: string; userId: string; deletedAt: Date | null }> = {}) => ({
    id: over.id ?? 'c1',
    paymentId: 'p1',
    userId: over.userId ?? 'u1',
    content: 'hi',
    createdAt: now,
    updatedAt: now,
    deletedAt: over.deletedAt ?? null,
    user: { id: over.userId ?? 'u1', name: 'Alice' },
  });

  // ── list ──

  describe('list()', () => {
    it('1. calls assertVisible with the viewer+paymentId', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', {});
      expect(paymentService.assertVisible).toHaveBeenCalledWith('u1', 'p1');
    });

    it('2. uses default limit=20 and where.deletedAt=null', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', {});
      const args = prisma.paymentComment.findMany.mock.calls[0][0];
      expect(args.take).toBe(21);
      expect(args.where).toEqual({ paymentId: 'p1', deletedAt: null });
    });

    it('3. clamps limit at 100', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', { limit: 500 });
      expect(prisma.paymentComment.findMany.mock.calls[0][0].take).toBe(101);
    });

    it('4. clamps limit at 1', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', { limit: 0 });
      expect(prisma.paymentComment.findMany.mock.calls[0][0].take).toBe(2);
    });

    it('5. orderBy is [createdAt asc, id asc]', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', {});
      expect(prisma.paymentComment.findMany.mock.calls[0][0].orderBy).toEqual([
        { createdAt: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('6. rejects malformed cursor with PAYMENT_COMMENT_INVALID_CURSOR', async () => {
      await expect(service.list('u1', 'p1', { cursor: 'not-base64-json' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('7. decodes a valid cursor and applies forward guard', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([]);
      const cur = encodeCommentCursor({ c: now.toISOString(), id: 'cX' });
      await service.list('u1', 'p1', { cursor: cur });
      const where = prisma.paymentComment.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeDefined();
      expect(where.AND[0].OR[0]).toMatchObject({ createdAt: { gt: expect.any(Date) } });
    });

    it('8. encodes nextCursor from last row when hasMore=true', async () => {
      const rows = [
        row({ id: 'c1' }),
        row({ id: 'c2' }),
        row({ id: 'c3' }), // peek
      ];
      prisma.paymentComment.findMany.mockResolvedValue(rows);
      const res = await service.list('u1', 'p1', { limit: 2 });
      expect(res.hasMore).toBe(true);
      expect(res.data).toHaveLength(2);
      expect(res.nextCursor).toBeTruthy();
      const decoded = decodeCommentCursor(res.nextCursor as string);
      expect(decoded?.id).toBe('c2'); // last row of the returned slice
    });

    it('9. nextCursor is null when hasMore=false', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([row({ id: 'c1' })]);
      const res = await service.list('u1', 'p1', { limit: 10 });
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('10. sets isMine per row correctly', async () => {
      prisma.paymentComment.findMany.mockResolvedValue([
        row({ id: 'a', userId: 'u1' }),
        row({ id: 'b', userId: 'u2' }),
      ]);
      const res = await service.list('u1', 'p1', {});
      expect(res.data.map((d) => d.isMine)).toEqual([true, false]);
    });

    it('11. visibility failure propagates', async () => {
      paymentService.assertVisible.mockRejectedValueOnce(new NotFoundException());
      await expect(service.list('u1', 'p1', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ──

  describe('create()', () => {
    it('12. calls assertVisible + creates with correct fields + isMine=true', async () => {
      prisma.paymentComment.create.mockResolvedValue(row());
      const dto = { content: 'hi' };
      const res = await service.create('u1', 'p1', dto);
      expect(paymentService.assertVisible).toHaveBeenCalledWith('u1', 'p1');
      expect(prisma.paymentComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { paymentId: 'p1', userId: 'u1', content: 'hi' },
        }),
      );
      expect(res.isMine).toBe(true);
      expect(res.content).toBe('hi');
    });

    it('13. writes PAYMENT_COMMENT_CREATED audit with commentId', async () => {
      prisma.paymentComment.create.mockResolvedValue(row({ id: 'cNew' }));
      await service.create('u1', 'p1', { content: 'x' });
      await new Promise((r) => setImmediate(r));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PAYMENT_COMMENT_CREATED',
            entityId: 'p1',
            userId: 'u1',
            details: { commentId: 'cNew' },
          }),
        }),
      );
    });

    it('14. visibility failure propagates', async () => {
      paymentService.assertVisible.mockRejectedValueOnce(new NotFoundException());
      await expect(service.create('u1', 'p1', { content: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('15. audit failure is swallowed (fire-and-forget)', async () => {
      prisma.paymentComment.create.mockResolvedValue(row());
      prisma.auditLog.create.mockRejectedValueOnce(new Error('db down'));
      await expect(service.create('u1', 'p1', { content: 'x' })).resolves.toMatchObject({
        content: 'hi',
      });
    });
  });

  // ── update ──

  describe('update()', () => {
    it('16. throws 404 PAYMENT_COMMENT_NOT_FOUND when the row is missing', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(null);
      await expect(service.update('u1', 'p1', 'cX', { content: 'y' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('17. throws 410 Gone PAYMENT_COMMENT_DELETED for soft-deleted rows', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(row({ deletedAt: new Date() }));
      let caught: HttpException | null = null;
      try {
        await service.update('u1', 'p1', 'c1', { content: 'y' });
      } catch (e) {
        caught = e as HttpException;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught?.getStatus()).toBe(HttpStatus.GONE);
    });

    it('18. throws 403 PAYMENT_COMMENT_NOT_AUTHOR for non-author', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(row({ userId: 'u2' }));
      await expect(service.update('u1', 'p1', 'c1', { content: 'y' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('19. updates content and writes PAYMENT_COMMENT_UPDATED audit', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(row());
      const newRow = { ...row(), content: 'edited', updatedAt: new Date(now.getTime() + 1000) };
      prisma.paymentComment.update.mockResolvedValue(newRow);
      const res = await service.update('u1', 'p1', 'c1', { content: 'edited' });
      expect(prisma.paymentComment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: { content: 'edited' } }),
      );
      await new Promise((r) => setImmediate(r));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PAYMENT_COMMENT_UPDATED' }),
        }),
      );
      expect(res.content).toBe('edited');
    });

    it('20. visibility failure propagates', async () => {
      paymentService.assertVisible.mockRejectedValueOnce(new NotFoundException());
      await expect(service.update('u1', 'p1', 'c1', { content: 'y' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── remove ──

  describe('remove()', () => {
    it('21. 404 when row missing', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(null);
      await expect(service.remove('u1', 'p1', 'cX')).rejects.toThrow(NotFoundException);
    });

    it('22. 410 Gone when already deleted', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(row({ deletedAt: new Date() }));
      let caught: HttpException | null = null;
      try {
        await service.remove('u1', 'p1', 'c1');
      } catch (e) {
        caught = e as HttpException;
      }
      expect(caught?.getStatus()).toBe(HttpStatus.GONE);
    });

    it('23. 403 for non-author', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(row({ userId: 'u2' }));
      await expect(service.remove('u1', 'p1', 'c1')).rejects.toThrow(ForbiddenException);
    });

    it('24. soft-deletes with content="" + deletedAt set', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(row());
      prisma.paymentComment.update.mockResolvedValue(row());
      await service.remove('u1', 'p1', 'c1');
      const args = prisma.paymentComment.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'c1' });
      expect(args.data.content).toBe('');
      expect(args.data.deletedAt).toBeInstanceOf(Date);
    });

    it('25. writes PAYMENT_COMMENT_DELETED audit', async () => {
      prisma.paymentComment.findFirst.mockResolvedValue(row());
      prisma.paymentComment.update.mockResolvedValue(row());
      await service.remove('u1', 'p1', 'c1');
      await new Promise((r) => setImmediate(r));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PAYMENT_COMMENT_DELETED' }),
        }),
      );
    });

    it('26. visibility failure propagates', async () => {
      paymentService.assertVisible.mockRejectedValueOnce(new NotFoundException());
      await expect(service.remove('u1', 'p1', 'c1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── cursor helpers ──

  describe('cursor helpers', () => {
    it('27. encode → decode roundtrip', () => {
      const c = { c: now.toISOString(), id: 'abc' };
      expect(decodeCommentCursor(encodeCommentCursor(c))).toEqual(c);
    });

    it('28. decode returns null on junk', () => {
      expect(decodeCommentCursor('%%%%')).toBeNull();
    });

    it('29. decode returns null when c is not a date', () => {
      const bad = Buffer.from(JSON.stringify({ c: 'nope', id: 'x' })).toString('base64url');
      expect(decodeCommentCursor(bad)).toBeNull();
    });
  });
});
