import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * POST /receipts/:id/link body (Phase 8.28) — glue an already-existing receipt
 * to an already-existing expense transaction. Unlike 8.15 (which uploads a NEW
 * receipt onto a transaction) both sides exist here; the operation only sets
 * `receipts.transaction_id`. A REVIEW receipt is finished via reconcile after
 * linking; a CONFIRMED orphan is done immediately.
 */
export class LinkReceiptDto {
  @ApiProperty({ description: 'The expense transaction to link this receipt to.' })
  @IsUUID()
  transactionId!: string;
}
