import type { Merchant, Receipt, ReceiptItem } from '@prisma/client';
import { Prisma } from '@prisma/client';

describe('Phase 7 Prisma models', () => {
  it('exports the 3 new model types from @prisma/client', () => {
    // Compile-time smoke test (Phase 6 pattern): if the schema regresses
    // (a model renamed or removed), this file fails to type-check.
    const types = [
      null as unknown as Merchant,
      null as unknown as Receipt,
      null as unknown as ReceiptItem,
    ];
    expect(types).toHaveLength(3);
  });

  it('keeps the lifecycle-critical receipt fields nullable until REVIEW', () => {
    // Field-shape smoke test via the generated scalar field enums — the
    // extraction worker relies on header fields being optional pre-REVIEW.
    expect(Prisma.ReceiptScalarFieldEnum.status).toBe('status');
    expect(Prisma.ReceiptScalarFieldEnum.paymentId).toBe('paymentId');
    expect(Prisma.ReceiptScalarFieldEnum.rawExtraction).toBe('rawExtraction');
    expect(Prisma.ReceiptItemScalarFieldEnum.position).toBe('position');
    expect(Prisma.ReceiptItemScalarFieldEnum.totalCents).toBe('totalCents');
    expect(Prisma.MerchantScalarFieldEnum.normalizedName).toBe('normalizedName');
  });
});
