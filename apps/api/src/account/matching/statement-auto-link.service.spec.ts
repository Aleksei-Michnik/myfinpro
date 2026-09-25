import { Logger } from '@nestjs/common';
import { EventBus } from '../../realtime/event-bus.service';
import type { RealtimeEvent } from '../../realtime/events.types';
import type { TransactionSummaryDto } from '../../transaction/dto/transaction-summary.dto';
import { StatementAutoLinkService } from './statement-auto-link.service';
import { StatementMatchingService } from './statement-matching.service';

/**
 * Phase 20 · Iteration 20.6 — the trigger (design §5.5): what a committed
 * transaction has to look like for the auto-linker to spend a query on it,
 * and the guarantee that nothing it does can reach the request that caused it.
 */
describe('StatementAutoLinkService', () => {
  let bus: EventBus;
  let service: StatementAutoLinkService;
  const matching = { autoLink: jest.fn() };

  const summary = (over: Partial<TransactionSummaryDto> = {}): TransactionSummaryDto =>
    ({
      id: 'tx-1',
      direction: 'OUT',
      type: 'ONE_TIME',
      amountCents: 12500,
      currency: 'ILS',
      occurredAt: '2026-09-10T00:00:00.000Z',
      status: 'POSTED',
      categories: [],
      attributions: [],
      commentCount: 0,
      starredByMe: false,
      hasDocuments: false,
      accountId: 'acc-1',
      transferAccountId: null,
      statementLineId: null,
      createdById: 'user-1',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      ...over,
    }) as TransactionSummaryDto;

  const created = (over: Partial<TransactionSummaryDto> = {}): RealtimeEvent => ({
    type: 'transaction.created',
    userIds: ['user-1'],
    transaction: summary(over),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    matching.autoLink.mockResolvedValue(null);
    bus = new EventBus();
    service = new StatementAutoLinkService(bus, matching as unknown as StatementMatchingService);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    bus.onApplicationShutdown();
    jest.restoreAllMocks();
  });

  it('asks for a link when a transaction lands on an account, under its creator', () => {
    bus.publish(created());
    expect(matching.autoLink).toHaveBeenCalledWith('user-1', 'tx-1');
  });

  it('also reacts to an update — a receipt confirm places the account later', () => {
    bus.publish({ type: 'transaction.updated', userIds: ['user-1'], transaction: summary() });
    expect(matching.autoLink).toHaveBeenCalledWith('user-1', 'tx-1');
  });

  it.each([
    ['there is no account', { accountId: null }],
    ['the row is a transfer', { transferAccountId: 'acc-2' }],
    ['a line already confirms it', { statementLineId: 'line-9' }],
    ['it is not a one-off', { type: 'RECURRING' }],
    ['its status can never settle', { status: 'CANCELLED' }],
  ])('spends no query when %s', (_label, over) => {
    bus.publish(created(over));
    expect(matching.autoLink).not.toHaveBeenCalled();
  });

  it('ignores events of other kinds', () => {
    bus.publish({ type: 'transaction.deleted', userIds: ['user-1'], transactionId: 'tx-1' });
    expect(matching.autoLink).not.toHaveBeenCalled();
  });

  it('never lets a failure escape the publisher', () => {
    matching.autoLink.mockRejectedValue(new Error('nope'));
    expect(() => bus.publish(created())).not.toThrow();
  });

  it('stops listening once the module is destroyed', () => {
    service.onModuleDestroy();
    bus.publish(created());
    expect(matching.autoLink).not.toHaveBeenCalled();
  });
});
