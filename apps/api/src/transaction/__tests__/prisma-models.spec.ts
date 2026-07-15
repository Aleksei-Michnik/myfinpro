import type {
  Transaction,
  TransactionAttribution,
  Category,
  TransactionPlan,
  TransactionSchedule,
  TransactionComment,
  TransactionStar,
  TransactionDocument,
} from '@prisma/client';

describe('Phase 6 Prisma models', () => {
  it('exports all 8 new model types from @prisma/client', () => {
    // Compile-time smoke test: asserts that the generated Prisma client
    // exports the expected types. If the schema regresses (a model is
    // renamed or removed), this file will fail to type-check.
    const types = [
      null as unknown as Transaction,
      null as unknown as TransactionAttribution,
      null as unknown as Category,
      null as unknown as TransactionPlan,
      null as unknown as TransactionSchedule,
      null as unknown as TransactionComment,
      null as unknown as TransactionStar,
      null as unknown as TransactionDocument,
    ];
    expect(types).toHaveLength(8);
  });
});
