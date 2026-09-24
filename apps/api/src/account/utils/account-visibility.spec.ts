import { buildAccountVisibilityWhere } from './account-visibility';

describe('buildAccountVisibilityWhere', () => {
  it("matches the caller's own personal accounts and every group they are in", () => {
    expect(buildAccountVisibilityWhere('u1')).toEqual({
      OR: [
        { scopeType: 'personal', ownerId: 'u1' },
        { scopeType: 'group', group: { memberships: { some: { userId: 'u1' } } } },
      ],
    });
  });

  it("never matches another user's personal account by construction", () => {
    const where = buildAccountVisibilityWhere('u1');
    const personal = where.OR!.find((c) => (c as { scopeType?: string }).scopeType === 'personal');
    expect(personal).toEqual({ scopeType: 'personal', ownerId: 'u1' });
  });
});
