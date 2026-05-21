import { computePaymentRecipients } from './payment-event-recipients';
import type { PrismaService } from '../../prisma/prisma.service';

describe('computePaymentRecipients()', () => {
  const makePrisma = (memberships: Array<{ userId: string }>) =>
    ({
      groupMembership: {
        findMany: jest.fn().mockResolvedValue(memberships),
      },
    }) as unknown as PrismaService;

  it('always includes the creator', async () => {
    const r = await computePaymentRecipients(makePrisma([]), [], 'creator-1');
    expect(r).toEqual(['creator-1']);
  });

  it('includes personal-attribution userIds', async () => {
    const r = await computePaymentRecipients(
      makePrisma([]),
      [
        { scopeType: 'personal', userId: 'creator-1', groupId: null },
        { scopeType: 'personal', userId: 'co-1', groupId: null },
      ],
      'creator-1',
    );
    expect(new Set(r)).toEqual(new Set(['creator-1', 'co-1']));
  });

  it('expands group attributions to all members via one DB call', async () => {
    const prisma = makePrisma([{ userId: 'm-1' }, { userId: 'm-2' }, { userId: 'creator-1' }]);
    const r = await computePaymentRecipients(
      prisma,
      [{ scopeType: 'group', userId: null, groupId: 'g-1' }],
      'creator-1',
    );
    expect(new Set(r)).toEqual(new Set(['creator-1', 'm-1', 'm-2']));
    expect((prisma.groupMembership.findMany as jest.Mock).mock.calls[0][0].where.groupId).toEqual({
      in: ['g-1'],
    });
  });

  it('combines multi-group + personal without DB N+1', async () => {
    const prisma = makePrisma([{ userId: 'm-1' }, { userId: 'm-2' }]);
    const r = await computePaymentRecipients(
      prisma,
      [
        { scopeType: 'personal', userId: 'co-1', groupId: null },
        { scopeType: 'group', userId: null, groupId: 'g-1' },
        { scopeType: 'group', userId: null, groupId: 'g-2' },
      ],
      'creator-1',
    );
    expect(new Set(r)).toEqual(new Set(['creator-1', 'co-1', 'm-1', 'm-2']));
    // Single findMany call for both groups.
    expect(prisma.groupMembership.findMany as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('does not query memberships when no group attributions are present', async () => {
    const prisma = makePrisma([]);
    await computePaymentRecipients(
      prisma,
      [{ scopeType: 'personal', userId: 'creator-1', groupId: null }],
      'creator-1',
    );
    expect(prisma.groupMembership.findMany).not.toHaveBeenCalled();
  });

  it('deduplicates when the creator is also a member of an attributed group', async () => {
    const prisma = makePrisma([{ userId: 'creator-1' }]);
    const r = await computePaymentRecipients(
      prisma,
      [{ scopeType: 'group', userId: null, groupId: 'g-1' }],
      'creator-1',
    );
    expect(r).toEqual(['creator-1']);
  });
});
