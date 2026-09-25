import { ConflictException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { StatementLineService } from '../statement-line.service';
import { StatementMatchingService } from './statement-matching.service';

/**
 * Phase 20 · Iteration 20.6 — `autoLink`, the transaction → line direction of
 * design §5.5.
 *
 * The arithmetic is tested in `statement-matcher.spec.ts`; what is tested
 * here is the decision to link at all: the gates a transaction must pass,
 * the refusal to resolve an ambiguity, and the contract that a lost race —
 * or anything else going wrong — is `null`, never a throw.
 */
describe('StatementMatchingService.autoLink', () => {
  let service: StatementMatchingService;

  const prisma = {
    transaction: { findFirst: jest.fn() },
    account: { findFirst: jest.fn() },
    accountStatementLine: { findMany: jest.fn(), count: jest.fn() },
  };
  const lines = { linkLineToTransaction: jest.fn() };

  const ACCOUNT = 'acc-1';
  const ACTOR = 'user-1';
  const OCCURRED_AT = new Date('2026-09-10T00:00:00Z');

  const transactionRow = (over: Record<string, unknown> = {}) => ({
    id: 'tx-1',
    type: 'ONE_TIME',
    status: 'POSTED',
    direction: 'OUT',
    amountCents: 12500,
    currency: 'ILS',
    occurredAt: OCCURRED_AT,
    accountId: ACCOUNT,
    transferAccountId: null,
    note: 'super pharm',
    category: { name: 'Groceries' },
    receipt: null,
    statementLine: null,
    ...over,
  });

  const lineRow = (over: Record<string, unknown> = {}) => ({
    id: 'line-1',
    accountId: ACCOUNT,
    direction: 'OUT',
    amountCents: 12500,
    currency: 'ILS',
    normalizedDescription: 'super pharm',
    postedAt: OCCURRED_AT,
    valueAt: null,
    status: 'PENDING',
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    prisma.transaction.findFirst.mockResolvedValue(transactionRow());
    prisma.account.findFirst.mockResolvedValue({ id: ACCOUNT, archivedAt: null });
    prisma.accountStatementLine.count.mockResolvedValue(0);
    prisma.accountStatementLine.findMany.mockResolvedValue([lineRow()]);
    lines.linkLineToTransaction.mockResolvedValue({ line: lineRow(), transaction: { id: 'tx-1' } });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        StatementMatchingService,
        { provide: PrismaService, useValue: prisma },
        { provide: StatementLineService, useValue: lines },
      ],
    }).compile();
    service = moduleRef.get(StatementMatchingService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('links the single confident pending line, through the queue’s own write path', async () => {
    const result = await service.autoLink(ACTOR, 'tx-1');

    expect(result).toEqual({ lineId: 'line-1' });
    expect(lines.linkLineToTransaction).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({ id: ACCOUNT }),
      expect.objectContaining({ id: 'line-1' }),
      'tx-1',
    );
  });

  it('does nothing when two lines are equally plausible', async () => {
    prisma.accountStatementLine.findMany.mockResolvedValue([
      lineRow({ id: 'line-1' }),
      lineRow({ id: 'line-2' }),
    ]);

    expect(await service.autoLink(ACTOR, 'tx-1')).toBeNull();
    expect(lines.linkLineToTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the only line is far away and describes something else', async () => {
    prisma.accountStatementLine.findMany.mockResolvedValue([
      lineRow({
        postedAt: new Date('2026-09-15T00:00:00Z'),
        normalizedDescription: 'hardware store',
      }),
    ]);

    expect(await service.autoLink(ACTOR, 'tx-1')).toBeNull();
    expect(lines.linkLineToTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['no account', { accountId: null }],
    ['a transfer', { transferAccountId: 'acc-2' }],
    ['a statement line already', { statementLine: { id: 'line-9' } }],
    ['a plan parent', { type: 'INSTALLMENT' }],
    ['a cancelled row', { status: 'CANCELLED' }],
  ])('refuses a transaction with %s', async (_label, over) => {
    prisma.transaction.findFirst.mockResolvedValue(transactionRow(over));

    expect(await service.autoLink(ACTOR, 'tx-1')).toBeNull();
    expect(prisma.accountStatementLine.findMany).not.toHaveBeenCalled();
    expect(lines.linkLineToTransaction).not.toHaveBeenCalled();
  });

  it('refuses a transaction the actor cannot see and an archived account', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);
    expect(await service.autoLink(ACTOR, 'tx-1')).toBeNull();

    prisma.transaction.findFirst.mockResolvedValue(transactionRow());
    prisma.account.findFirst.mockResolvedValue(null);
    expect(await service.autoLink(ACTOR, 'tx-1')).toBeNull();
    expect(lines.linkLineToTransaction).not.toHaveBeenCalled();
  });

  it('stands down while a review-queue decision is mid-flight on the account', async () => {
    prisma.accountStatementLine.count.mockResolvedValue(1);

    expect(await service.autoLink(ACTOR, 'tx-1')).toBeNull();
    expect(prisma.accountStatementLine.findMany).not.toHaveBeenCalled();
  });

  it('returns null when a concurrent decision won the claim', async () => {
    lines.linkLineToTransaction.mockRejectedValue(
      new ConflictException({ message: 'That line was already decided — unlink it first' }),
    );

    await expect(service.autoLink(ACTOR, 'tx-1')).resolves.toBeNull();
  });

  it('never throws to its caller', async () => {
    prisma.transaction.findFirst.mockRejectedValue(new Error('database is away'));

    await expect(service.autoLink(ACTOR, 'tx-1')).resolves.toBeNull();
  });
});
