import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../realtime/event-bus.service';
import {
  decodeCommentCursor,
  encodeCommentCursor,
  TransactionCommentService,
} from './transaction-comment.service';
import { TransactionService } from './transaction.service';

describe('TransactionCommentService', () => {
  let service: TransactionCommentService;

  const prisma = {
    transactionComment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    transaction: { findUnique: jest.fn() },
    groupMembership: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const transactionService = { assertVisible: jest.fn() };
  const eventBus = { publish: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
    // Default parent-transaction lookup → creator-only attribution. Individual
    // tests can override `prisma.transaction.findUnique` to inject group/personal
    // attributions when they want to assert on the recipient set.
    prisma.transaction.findUnique.mockResolvedValue({
      createdById: 'u1',
      attributions: [{ scopeType: 'personal', userId: 'u1', groupId: null }],
    });
    prisma.groupMembership.findMany.mockResolvedValue([]);
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionCommentService,
        { provide: PrismaService, useValue: prisma },
        { provide: TransactionService, useValue: transactionService },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();
    service = mod.get(TransactionCommentService);
  });

  const now = new Date('2026-05-01T10:00:00.000Z');
  const row = (over: Partial<{ id: string; userId: string; deletedAt: Date | null }> = {}) => ({
    id: over.id ?? 'c1',
    transactionId: 'p1',
    userId: over.userId ?? 'u1',
    content: 'hi',
    createdAt: now,
    updatedAt: now,
    deletedAt: over.deletedAt ?? null,
    user: { id: over.userId ?? 'u1', name: 'Alice' },
  });

  // ── list ──

  describe('list()', () => {
    it('1. calls assertVisible with the viewer+transactionId', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', {});
      expect(transactionService.assertVisible).toHaveBeenCalledWith('u1', 'p1');
    });

    it('2. uses default limit=20 and where.deletedAt=null', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', {});
      const args = prisma.transactionComment.findMany.mock.calls[0][0];
      expect(args.take).toBe(21);
      expect(args.where).toEqual({ transactionId: 'p1', deletedAt: null });
    });

    it('3. clamps limit at 100', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', { limit: 500 });
      expect(prisma.transactionComment.findMany.mock.calls[0][0].take).toBe(101);
    });

    it('4. clamps limit at 1', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', { limit: 0 });
      expect(prisma.transactionComment.findMany.mock.calls[0][0].take).toBe(2);
    });

    it('5. orderBy is [createdAt asc, id asc]', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([]);
      await service.list('u1', 'p1', {});
      expect(prisma.transactionComment.findMany.mock.calls[0][0].orderBy).toEqual([
        { createdAt: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('6. rejects malformed cursor with TRANSACTION_COMMENT_INVALID_CURSOR', async () => {
      await expect(service.list('u1', 'p1', { cursor: 'not-base64-json' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('7. decodes a valid cursor and applies forward guard', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([]);
      const cur = encodeCommentCursor({ c: now.toISOString(), id: 'cX' });
      await service.list('u1', 'p1', { cursor: cur });
      const where = prisma.transactionComment.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeDefined();
      expect(where.AND[0].OR[0]).toMatchObject({ createdAt: { gt: expect.any(Date) } });
    });

    it('8. encodes nextCursor from last row when hasMore=true', async () => {
      const rows = [
        row({ id: 'c1' }),
        row({ id: 'c2' }),
        row({ id: 'c3' }), // peek
      ];
      prisma.transactionComment.findMany.mockResolvedValue(rows);
      const res = await service.list('u1', 'p1', { limit: 2 });
      expect(res.hasMore).toBe(true);
      expect(res.data).toHaveLength(2);
      expect(res.nextCursor).toBeTruthy();
      const decoded = decodeCommentCursor(res.nextCursor as string);
      expect(decoded?.id).toBe('c2'); // last row of the returned slice
    });

    it('9. nextCursor is null when hasMore=false', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([row({ id: 'c1' })]);
      const res = await service.list('u1', 'p1', { limit: 10 });
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('10. sets isMine per row correctly', async () => {
      prisma.transactionComment.findMany.mockResolvedValue([
        row({ id: 'a', userId: 'u1' }),
        row({ id: 'b', userId: 'u2' }),
      ]);
      const res = await service.list('u1', 'p1', {});
      expect(res.data.map((d) => d.isMine)).toEqual([true, false]);
    });

    it('11. visibility failure propagates', async () => {
      transactionService.assertVisible.mockRejectedValueOnce(new NotFoundException());
      await expect(service.list('u1', 'p1', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ──

  describe('create()', () => {
    it('12. calls assertVisible + creates with correct fields + isMine=true', async () => {
      prisma.transactionComment.create.mockResolvedValue(row());
      const dto = { content: 'hi' };
      const res = await service.create('u1', 'p1', dto);
      expect(transactionService.assertVisible).toHaveBeenCalledWith('u1', 'p1');
      expect(prisma.transactionComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { transactionId: 'p1', userId: 'u1', content: 'hi' },
        }),
      );
      expect(res.isMine).toBe(true);
      expect(res.content).toBe('hi');
    });

    it('13. writes TRANSACTION_COMMENT_CREATED audit with commentId', async () => {
      prisma.transactionComment.create.mockResolvedValue(row({ id: 'cNew' }));
      await service.create('u1', 'p1', { content: 'x' });
      await new Promise((r) => setImmediate(r));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'TRANSACTION_COMMENT_CREATED',
            entityId: 'p1',
            userId: 'u1',
            details: { commentId: 'cNew' },
          }),
        }),
      );
    });

    it('14. visibility failure propagates', async () => {
      transactionService.assertVisible.mockRejectedValueOnce(new NotFoundException());
      await expect(service.create('u1', 'p1', { content: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('15. audit failure is swallowed (fire-and-forget)', async () => {
      prisma.transactionComment.create.mockResolvedValue(row());
      prisma.auditLog.create.mockRejectedValueOnce(new Error('db down'));
      await expect(service.create('u1', 'p1', { content: 'x' })).resolves.toMatchObject({
        content: 'hi',
      });
    });
  });

  // ── update ──

  describe('update()', () => {
    it('16. throws 404 TRANSACTION_COMMENT_NOT_FOUND when the row is missing', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(null);
      await expect(service.update('u1', 'p1', 'cX', { content: 'y' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('17. throws 410 Gone TRANSACTION_COMMENT_DELETED for soft-deleted rows', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row({ deletedAt: new Date() }));
      let caught: HttpException | null = null;
      try {
        await service.update('u1', 'p1', 'c1', { content: 'y' });
      } catch (e) {
        caught = e as HttpException;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught?.getStatus()).toBe(HttpStatus.GONE);
    });

    it('18. throws 403 TRANSACTION_COMMENT_NOT_AUTHOR for non-author', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row({ userId: 'u2' }));
      await expect(service.update('u1', 'p1', 'c1', { content: 'y' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('19. updates content and writes TRANSACTION_COMMENT_UPDATED audit', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row());
      const newRow = { ...row(), content: 'edited', updatedAt: new Date(now.getTime() + 1000) };
      prisma.transactionComment.update.mockResolvedValue(newRow);
      const res = await service.update('u1', 'p1', 'c1', { content: 'edited' });
      expect(prisma.transactionComment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: { content: 'edited' } }),
      );
      await new Promise((r) => setImmediate(r));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'TRANSACTION_COMMENT_UPDATED' }),
        }),
      );
      expect(res.content).toBe('edited');
    });

    it('20. visibility failure propagates', async () => {
      transactionService.assertVisible.mockRejectedValueOnce(new NotFoundException());
      await expect(service.update('u1', 'p1', 'c1', { content: 'y' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── remove ──

  describe('remove()', () => {
    it('21. 404 when row missing', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(null);
      await expect(service.remove('u1', 'p1', 'cX')).rejects.toThrow(NotFoundException);
    });

    it('22. 410 Gone when already deleted', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row({ deletedAt: new Date() }));
      let caught: HttpException | null = null;
      try {
        await service.remove('u1', 'p1', 'c1');
      } catch (e) {
        caught = e as HttpException;
      }
      expect(caught?.getStatus()).toBe(HttpStatus.GONE);
    });

    it('23. 403 for non-author', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row({ userId: 'u2' }));
      await expect(service.remove('u1', 'p1', 'c1')).rejects.toThrow(ForbiddenException);
    });

    it('24. soft-deletes with content="" + deletedAt set', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row());
      prisma.transactionComment.update.mockResolvedValue(row());
      await service.remove('u1', 'p1', 'c1');
      const args = prisma.transactionComment.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'c1' });
      expect(args.data.content).toBe('');
      expect(args.data.deletedAt).toBeInstanceOf(Date);
    });

    it('25. writes TRANSACTION_COMMENT_DELETED audit', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row());
      prisma.transactionComment.update.mockResolvedValue(row());
      await service.remove('u1', 'p1', 'c1');
      await new Promise((r) => setImmediate(r));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'TRANSACTION_COMMENT_DELETED' }),
        }),
      );
    });

    it('26. visibility failure propagates', async () => {
      transactionService.assertVisible.mockRejectedValueOnce(new NotFoundException());
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

  // ── realtime emission (iteration 6.18.1.4.2) ──

  describe('realtime EventBus fan-out', () => {
    it('30. create() publishes comment.created with multicast userIds', async () => {
      // Parent transaction is shared between Alice (creator/personal) and the
      // "house" group (g1) whose membership is { u1, u2, u3 }.
      prisma.transaction.findUnique.mockResolvedValueOnce({
        createdById: 'u1',
        attributions: [
          { scopeType: 'personal', userId: 'u1', groupId: null },
          { scopeType: 'group', userId: null, groupId: 'g1' },
        ],
      });
      prisma.groupMembership.findMany.mockResolvedValueOnce([
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      prisma.transactionComment.create.mockResolvedValue(row({ id: 'cNew' }));

      await service.create('u1', 'p1', { content: 'hi' });

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const arg = eventBus.publish.mock.calls[0][0];
      expect(arg.type).toBe('comment.created');
      expect(arg.transactionId).toBe('p1');
      expect(arg.comment.id).toBe('cNew');
      expect([...arg.userIds].sort()).toEqual(['u1', 'u2', 'u3']);
    });

    it('31. update() publishes comment.updated with the fresh DTO', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row());
      const newRow = { ...row(), content: 'edited' };
      prisma.transactionComment.update.mockResolvedValue(newRow);

      await service.update('u1', 'p1', 'c1', { content: 'edited' });

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const arg = eventBus.publish.mock.calls[0][0];
      expect(arg.type).toBe('comment.updated');
      expect(arg.transactionId).toBe('p1');
      expect(arg.comment.content).toBe('edited');
      expect(arg.userIds).toEqual(['u1']);
    });

    it('32. remove() publishes comment.deleted with transactionId + commentId', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(row());
      prisma.transactionComment.update.mockResolvedValue(row());

      await service.remove('u1', 'p1', 'c1');

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(eventBus.publish.mock.calls[0][0]).toEqual({
        type: 'comment.deleted',
        userIds: ['u1'],
        transactionId: 'p1',
        commentId: 'c1',
      });
    });

    it('33. publish failure is swallowed (best-effort)', async () => {
      prisma.transaction.findUnique.mockRejectedValueOnce(new Error('parent lookup down'));
      prisma.transactionComment.create.mockResolvedValue(row({ id: 'cNew' }));

      await expect(service.create('u1', 'p1', { content: 'hi' })).resolves.toMatchObject({
        id: 'cNew',
      });
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('34. failed authoring (404 / 410 / 403) does NOT publish anything', async () => {
      prisma.transactionComment.findFirst.mockResolvedValue(null);
      await expect(service.update('u1', 'p1', 'cX', { content: 'y' })).rejects.toThrow(
        NotFoundException,
      );
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });
});
