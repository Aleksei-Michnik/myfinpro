import type { ProductAliasSource, ProductMatchCandidate } from '@myfinpro/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Product, ProductAlias } from '@prisma/client';

/** One registry alias (Phase 8.2). */
export class ProductAliasResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'BCP-47 of the confirmer.' })
  locale!: string | null;

  @ApiProperty({ enum: ['confirmation', 'manual', 'extraction', 'off'] })
  source!: ProductAliasSource;

  @ApiProperty({ description: 'Times a walkthrough confirmed this spelling.' })
  confirmationCount!: number;
}

/**
 * Caller-scoped purchase stats (the PRIVATE layer — always derived from the
 * caller's own confirmed receipts, never from other users').
 */
export class ProductStatsDto {
  @ApiProperty({ description: 'Confirmed receipt lines of the caller linked to this product.' })
  timesPurchased!: number;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'ISO 8601 datetime.' })
  lastPurchasedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  lastUnitPriceCents!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastCurrency!: string | null;
}

/** Wire shape of a global registry product. */
export class ProductResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'GTIN-8/12/13/14.' })
  barcode!: string | null;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  brand!: string | null;

  @ApiProperty({ description: 'True when a processed image is available.' })
  hasImage!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Cache-busting token for GET /products/:id/image (changes on re-upload).',
  })
  imageVersion!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'System OUT category.' })
  defaultCategoryId!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional({ type: ProductStatsDto, description: 'Present on caller-scoped reads.' })
  stats?: ProductStatsDto;

  @ApiPropertyOptional({ type: [ProductAliasResponseDto], description: 'Detail reads only.' })
  aliases?: ProductAliasResponseDto[];
}

/** List envelope (Phase 6 pagination conventions). */
export interface ProductListResponse {
  data: ProductResponseDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** One purchase-history row — caller's confirmed receipts only. */
export class ProductPurchaseRowDto {
  @ApiProperty()
  receiptId!: string;

  @ApiProperty({ description: 'ISO 8601 purchase datetime.' })
  purchasedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  merchantName!: string | null;

  @ApiProperty()
  quantity!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  unitPriceCents!: number | null;

  @ApiProperty()
  totalCents!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  currency!: string | null;
}

/** Per-merchant price aggregate for the detail page (design §3). */
export class ProductMerchantPriceDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  merchantName!: string | null;

  @ApiProperty()
  purchases!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  lastUnitPriceCents!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  minUnitPriceCents!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  maxUnitPriceCents!: number | null;

  @ApiProperty({ description: 'ISO 8601 datetime of the latest purchase.' })
  lastPurchasedAt!: string;
}

export class ProductPurchasesResponseDto {
  @ApiProperty({ type: [ProductPurchaseRowDto] })
  purchases!: ProductPurchaseRowDto[];

  @ApiProperty({ type: [ProductMerchantPriceDto] })
  merchants!: ProductMerchantPriceDto[];
}

/** Barcode resolution — local registry hit, OFF prefill, or manual entry. */
export class BarcodeLookupResponseDto {
  @ApiProperty({ description: 'True when the barcode resolved to a registry product.' })
  found!: boolean;

  @ApiPropertyOptional({ type: ProductResponseDto })
  product?: ProductResponseDto;

  @ApiPropertyOptional({
    description: 'Open Food Facts prefill for the create form (registry miss).',
  })
  prefill?: { name: string | null; brand: string | null; imageUrl: string | null };

  @ApiProperty({
    enum: ['registry', 'off', 'miss', 'unavailable', 'disabled'],
    description:
      'registry = local hit; off = OFF prefill; miss = unknown everywhere; ' +
      'unavailable = OFF down (circuit open / error); disabled = OFF turned off.',
  })
  offStatus!: 'registry' | 'off' | 'miss' | 'unavailable' | 'disabled';
}

export function mapAliasToDto(row: ProductAlias): ProductAliasResponseDto {
  return {
    id: row.id,
    name: row.name,
    locale: row.locale,
    source: row.source as ProductAliasSource,
    confirmationCount: row.confirmationCount,
  };
}

// The fileRef is server-internal; its basename is stable per version and
// safe to expose as a cache key.
export function productImageVersion(imageRef: string | null): string | null {
  return imageRef ? imageRef.split('/').pop()!.split('.')[0] : null;
}

export function mapProductToDto(
  row: Product,
  extras?: { stats?: ProductStatsDto; aliases?: ProductAlias[] },
): ProductResponseDto {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    hasImage: row.imageRef !== null,
    imageVersion: productImageVersion(row.imageRef),
    defaultCategoryId: row.defaultCategoryId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(extras?.stats ? { stats: extras.stats } : {}),
    ...(extras?.aliases ? { aliases: extras.aliases.map(mapAliasToDto) } : {}),
  };
}

/** Re-exported for controller signatures. */
export type { ProductMatchCandidate };
