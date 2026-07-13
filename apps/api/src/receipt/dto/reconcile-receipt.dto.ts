import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * POST /receipts/:id/reconcile body (Phase 8.15) — the confirm step for a
 * receipt attached to an existing payment. Each flag decides whether the
 * reviewed receipt's value overwrites the payment's; item/product links are
 * saved regardless of the choices.
 */
export class ReconcileReceiptDto {
  @ApiProperty({ description: "Overwrite the payment's amount (and currency) with the receipt's." })
  @IsBoolean()
  applyTotal!: boolean;

  @ApiProperty({ description: "Overwrite the payment's category with the receipt's dominant one." })
  @IsBoolean()
  applyCategory!: boolean;
}
