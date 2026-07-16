import {
  computeTotalsMismatch,
  RECEIPT_SOURCES,
  RECEIPT_STATUSES,
  type ProductMatchCandidate,
  type ProductMatchStatus,
  type ReceiptSource,
  type ReceiptStatus,
} from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Merchant, Product, Receipt, ReceiptItem } from '@prisma/client';

/**
 * Wire shape for one receipt line item (Phase 7.4). Money is integer
 * cents; `quantity` crosses the wire as a plain number (Prisma Decimal
 * serialized) — 3 decimal places max per the schema.
 */
export class ReceiptItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '1-based order on the receipt.' })
  position!: number;

  @ApiProperty()
  rawName!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Product code read off the printed line (normalized GTIN), 8.21.',
  })
  barcode!: string | null;

  @ApiProperty({ description: 'Decimal quantities allowed (e.g. 0.732 kg).' })
  quantity!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  unitPriceCents!: number | null;

  @ApiProperty({ description: 'Line-level discount, ≥ 0.' })
  discountCents!: number;

  @ApiProperty({ description: 'Line total AFTER discount.' })
  totalCents!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  categoryId!: string | null;

  // ── Phase 8: product matching ──

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Linked registry product.' })
  productId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Joined registry name.' })
  productName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  productBrand!: string | null;

  @ApiProperty({ enum: ['PENDING', 'AUTO', 'CONFIRMED', 'SKIPPED'] })
  matchStatus!: ProductMatchStatus;

  @ApiProperty({
    description: 'Staged-matcher proposals ranked by confidence (walkthrough input).',
    isArray: true,
  })
  matchCandidates!: ProductMatchCandidate[];
}

/** Wire shape returned by every receipt endpoint. */
export class ReceiptResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: [...RECEIPT_STATUSES] })
  status!: ReceiptStatus;

  @ApiProperty({ enum: [...RECEIPT_SOURCES] })
  source!: ReceiptSource;

  @ApiPropertyOptional({ nullable: true, type: String })
  originalName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  mimeType!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  sizeBytes!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  sourceUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  merchantId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Joined registry name.' })
  merchantName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  extractedMerchantName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'ISO 8601 datetime' })
  purchasedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  currency!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  totalCents!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Receipt-level discount.' })
  discountCents!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  failureReason!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Set on confirm.' })
  transactionId!: string | null;

  @ApiProperty({ description: 'Σ item totals (advisory).' })
  itemsSumCents!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'totalCents − (Σ items − receipt discount). Non-zero renders a review warning; never blocks.',
  })
  totalsMismatchCents!: number | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: [ReceiptItemResponseDto] })
  items!: ReceiptItemResponseDto[];
}

export type ReceiptItemWithProduct = ReceiptItem & {
  product: Pick<Product, 'name' | 'brand'> | null;
};

export type ReceiptWithRelations = Receipt & {
  items: ReceiptItemWithProduct[];
  merchant: Pick<Merchant, 'name'> | null;
};

export function mapReceiptItemToDto(item: ReceiptItemWithProduct): ReceiptItemResponseDto {
  return {
    id: item.id,
    position: item.position,
    rawName: item.rawName,
    barcode: item.barcode,
    quantity: Number(item.quantity),
    unitPriceCents: item.unitPriceCents,
    discountCents: item.discountCents,
    totalCents: item.totalCents,
    categoryId: item.categoryId,
    productId: item.productId,
    productName: item.product?.name ?? null,
    productBrand: item.product?.brand ?? null,
    matchStatus: item.matchStatus as ProductMatchStatus,
    matchCandidates: Array.isArray(item.matchCandidates)
      ? (item.matchCandidates as unknown as ProductMatchCandidate[])
      : [],
  };
}

export function mapReceiptToDto(row: ReceiptWithRelations): ReceiptResponseDto {
  const items = [...row.items].sort((a, b) => a.position - b.position).map(mapReceiptItemToDto);
  const { itemsSumCents, mismatchCents } = computeTotalsMismatch({
    totalCents: row.totalCents,
    discountCents: row.discountCents,
    items,
  });
  return {
    id: row.id,
    status: row.status as ReceiptStatus,
    source: row.source as ReceiptSource,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sourceUrl: row.sourceUrl,
    merchantId: row.merchantId,
    merchantName: row.merchant?.name ?? null,
    extractedMerchantName: row.extractedMerchantName,
    purchasedAt: row.purchasedAt ? row.purchasedAt.toISOString() : null,
    currency: row.currency,
    totalCents: row.totalCents,
    discountCents: row.discountCents,
    failureReason: row.failureReason,
    transactionId: row.transactionId,
    itemsSumCents,
    totalsMismatchCents: mismatchCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items,
  };
}
