import type {
  Payment,
  PaymentAttribution,
  Category,
  PaymentPlan,
  PaymentSchedule,
  PaymentComment,
  PaymentStar,
  PaymentDocument,
} from '@prisma/client';

describe('Phase 6 Prisma models', () => {
  it('exports all 8 new model types from @prisma/client', () => {
    // Compile-time smoke test: asserts that the generated Prisma client
    // exports the expected types. If the schema regresses (a model is
    // renamed or removed), this file will fail to type-check.
    const types = [
      null as unknown as Payment,
      null as unknown as PaymentAttribution,
      null as unknown as Category,
      null as unknown as PaymentPlan,
      null as unknown as PaymentSchedule,
      null as unknown as PaymentComment,
      null as unknown as PaymentStar,
      null as unknown as PaymentDocument,
    ];
    expect(types).toHaveLength(8);
  });
});
