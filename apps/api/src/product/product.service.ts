import {
  decodeCursor,
  encodeCursor,
  isValidGtin,
  normalizeGtin,
  normalizeLookupName,
  PAGINATION_DEFAULTS,
  PRODUCT_NAME_MAX_LENGTH,
  type ProductAliasSource,
} from '@myfinpro/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_ERRORS } from './constants/product-errors';
import { AddAliasDto } from './dto/add-alias.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import {
  mapProductToDto,
  PRODUCT_PRIMARY_IMAGE_INCLUDE,
  type BarcodeLookupResponseDto,
  type ProductListResponse,
  type ProductPurchasesResponseDto,
  type ProductResponseDto,
  type ProductStatsDto,
} from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { OpenFoodFactsService } from './open-food-facts.service';
import { ProductImageService } from './product-image.service';
import { ProductMatchingService } from './product-matching.service';

/** Ranked registry search cap (design §3). */
const SEARCH_LIMIT = 20;
/** Purchase-history rows returned to the detail page. */
const PURCHASES_LIMIT = 100;

/**
 * Phase 8, iteration 8.2 — the product registry service (design §1.1).
 *
 * The registry itself (products + aliases) is GLOBAL: reads and writes are
 * available to every authenticated user and audited. Everything derived
 * from receipts (stats, purchase history, "my products") is scoped to the
 * caller's own uploads — the privacy boundary of the two-layer design.
 */
@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: ProductMatchingService,
    private readonly off: OpenFoodFactsService,
    private readonly images: ProductImageService,
  ) {}

  /** GET /products — search (global, ranked) or my-products (paginated). */
  async list(userId: string, q: ListProductsQueryDto): Promise<ProductListResponse> {
    if (q.search?.trim()) {
      const candidates = await this.matcher.searchRegistry(q.search.trim(), SEARCH_LIMIT);
      const rows = await this.prisma.product.findMany({
        where: { id: { in: candidates.map((c) => c.productId) } },
        include: PRODUCT_PRIMARY_IMAGE_INCLUDE,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const stats = await this.loadStats(
        userId,
        rows.map((r) => r.id),
      );
      return {
        data: candidates
          .map((c) => byId.get(c.productId))
          .filter((row): row is (typeof rows)[number] => row !== undefined)
          .map((row) => mapProductToDto(row, { stats: stats.get(row.id) })),
        nextCursor: null,
        hasMore: false,
      };
    }
    return this.listPurchased(userId, q);
  }

  /** GET /products/:id — registry row + aliases + caller-scoped stats. */
  async getOne(userId: string, id: string): Promise<ProductResponseDto> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: {
        aliases: { orderBy: [{ confirmationCount: 'desc' }, { name: 'asc' }] },
        images: { orderBy: { position: 'asc' } },
      },
    });
    if (!row) this.throwNotFound();
    const stats = await this.loadStats(userId, [row.id]);
    return mapProductToDto(row, {
      stats: stats.get(row.id),
      aliases: row.aliases,
      images: row.images,
    });
  }

  /** GET /products/:id/purchases — caller's confirmed purchases only. */
  async purchases(userId: string, id: string): Promise<ProductPurchasesResponseDto> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) this.throwNotFound();

    // One indexed query; merchant/currency ride the receipt include.
    const rows = await this.prisma.receiptItem.findMany({
      where: {
        productId: id,
        receipt: { uploadedById: userId, status: 'CONFIRMED' },
      },
      orderBy: [{ purchasedAt: 'desc' }],
      take: PURCHASES_LIMIT,
      select: {
        receiptId: true,
        purchasedAt: true,
        quantity: true,
        unitPriceCents: true,
        totalCents: true,
        receipt: { select: { currency: true, merchant: { select: { name: true } } } },
      },
    });

    const purchases = rows.map((row) => ({
      receiptId: row.receiptId,
      purchasedAt: (row.purchasedAt ?? new Date(0)).toISOString(),
      merchantName: row.receipt.merchant?.name ?? null,
      quantity: Number(row.quantity),
      unitPriceCents: row.unitPriceCents,
      totalCents: row.totalCents,
      currency: row.receipt.currency,
    }));

    // Per-merchant aggregate — rows are already capped, so in-process.
    const byMerchant = new Map<
      string,
      {
        merchantName: string | null;
        purchases: number;
        lastUnitPriceCents: number | null;
        minUnitPriceCents: number | null;
        maxUnitPriceCents: number | null;
        lastPurchasedAt: string;
      }
    >();
    for (const p of purchases) {
      const key = p.merchantName ?? '';
      const entry = byMerchant.get(key);
      if (!entry) {
        byMerchant.set(key, {
          merchantName: p.merchantName,
          purchases: 1,
          lastUnitPriceCents: p.unitPriceCents,
          minUnitPriceCents: p.unitPriceCents,
          maxUnitPriceCents: p.unitPriceCents,
          lastPurchasedAt: p.purchasedAt,
        });
        continue;
      }
      entry.purchases++;
      if (p.unitPriceCents !== null) {
        entry.minUnitPriceCents =
          entry.minUnitPriceCents === null
            ? p.unitPriceCents
            : Math.min(entry.minUnitPriceCents, p.unitPriceCents);
        entry.maxUnitPriceCents =
          entry.maxUnitPriceCents === null
            ? p.unitPriceCents
            : Math.max(entry.maxUnitPriceCents, p.unitPriceCents);
        // Rows are newest-first; keep the first non-null as "last".
        if (entry.lastUnitPriceCents === null) entry.lastUnitPriceCents = p.unitPriceCents;
      }
    }
    return {
      purchases,
      merchants: [...byMerchant.values()].sort((a, b) => b.purchases - a.purchases),
    };
  }

  /** POST /products — publish to the global registry (design §1.1). */
  async create(userId: string, dto: CreateProductDto): Promise<ProductResponseDto> {
    const name = dto.name.trim().slice(0, PRODUCT_NAME_MAX_LENGTH);
    const normalizedName = normalizeLookupName(name, PRODUCT_NAME_MAX_LENGTH);
    if (!normalizedName) {
      throw new BadRequestException({
        message: 'Product name is required',
        errorCode: PRODUCT_ERRORS.PRODUCT_MATCH_INVALID,
      });
    }
    const barcode = await this.validateBarcode(dto.barcode ?? null);
    if (dto.defaultCategoryId) await this.assertSystemOutCategory(dto.defaultCategoryId);

    const row = await this.prisma.product.create({
      data: {
        name,
        normalizedName,
        brand: dto.brand?.trim() || null,
        barcode,
        defaultCategoryId: dto.defaultCategoryId ?? null,
        // The canonical name doubles as the first alias so alias-stage
        // matching works from day one.
        aliases: {
          create: {
            name,
            normalizedName,
            locale: dto.aliasLocale ?? null,
            source: 'manual',
          },
        },
      },
    });
    void this.writeAudit(userId, row.id, 'PRODUCT_CREATED', { name, barcode });
    this.logger.log(`Product ${row.id} created by user ${userId}`);
    // OFF prefill image rides the background queue (design §1.5) — creation
    // never waits on a third-party image host.
    if (dto.imageUrl) await this.images.addFromUrl(row.id, dto.imageUrl);
    return mapProductToDto({ ...row, images: [] });
  }

  /** PATCH /products/:id — registry update (audited). */
  async update(userId: string, id: string, dto: UpdateProductDto): Promise<ProductResponseDto> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) this.throwNotFound();

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim().slice(0, PRODUCT_NAME_MAX_LENGTH);
      const normalizedName = normalizeLookupName(name, PRODUCT_NAME_MAX_LENGTH);
      if (!normalizedName) {
        throw new BadRequestException({
          message: 'Product name is required',
          errorCode: PRODUCT_ERRORS.PRODUCT_MATCH_INVALID,
        });
      }
      data.name = name;
      data.normalizedName = normalizedName;
    }
    if (dto.brand !== undefined) data.brand = dto.brand?.trim() || null;
    if (dto.barcode !== undefined) {
      data.barcode = await this.validateBarcode(dto.barcode, id);
    }
    if (dto.defaultCategoryId !== undefined) {
      if (dto.defaultCategoryId) await this.assertSystemOutCategory(dto.defaultCategoryId);
      data.defaultCategory = dto.defaultCategoryId
        ? { connect: { id: dto.defaultCategoryId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data,
      include: PRODUCT_PRIMARY_IMAGE_INCLUDE,
    });
    void this.writeAudit(userId, id, 'PRODUCT_UPDATED', { changed: Object.keys(data) });
    return mapProductToDto(updated);
  }

  /** POST /products/:id/aliases — manual alias add (upsert semantics). */
  async addAlias(userId: string, id: string, dto: AddAliasDto): Promise<ProductResponseDto> {
    const row = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!row) this.throwNotFound();
    await this.recordAlias(this.prisma, userId, id, dto.name, dto.locale ?? null, 'manual');
    return this.getOne(userId, id);
  }

  /**
   * Alias upsert — THE registry auto-update primitive (design §1.3, 8.5).
   * New spelling → row with count 1; known spelling → count bump. Callable
   * inside a transaction (walkthrough confirm) or standalone.
   */
  async recordAlias(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    productId: string,
    rawName: string,
    locale: string | null,
    source: ProductAliasSource,
  ): Promise<void> {
    const name = rawName.trim().slice(0, PRODUCT_NAME_MAX_LENGTH);
    const normalizedName = normalizeLookupName(name, PRODUCT_NAME_MAX_LENGTH);
    if (!normalizedName) return;
    await db.productAlias.upsert({
      where: { productId_normalizedName: { productId, normalizedName } },
      create: { productId, name, normalizedName, locale, source },
      update: { confirmationCount: { increment: 1 }, ...(locale ? { locale } : {}) },
    });
    void this.writeAudit(userId, productId, 'PRODUCT_ALIAS_RECORDED', {
      name,
      locale,
      source,
    });
  }

  /** GET /products/barcode/:code — local registry, then OFF (design §1.4). */
  async lookupBarcode(userId: string, raw: string): Promise<BarcodeLookupResponseDto> {
    const barcode = normalizeGtin(raw);
    if (!isValidGtin(barcode)) {
      throw new BadRequestException({
        message: 'Not a valid GTIN-8/12/13/14 barcode',
        errorCode: PRODUCT_ERRORS.PRODUCT_INVALID_BARCODE,
      });
    }
    const row = await this.prisma.product.findUnique({
      where: { barcode },
      include: PRODUCT_PRIMARY_IMAGE_INCLUDE,
    });
    if (row) {
      const stats = await this.loadStats(userId, [row.id]);
      return {
        found: true,
        product: mapProductToDto(row, { stats: stats.get(row.id) }),
        offStatus: 'registry',
      };
    }
    const off = await this.off.lookup(barcode);
    if (off.status === 'hit') {
      return {
        found: false,
        prefill: { name: off.name, brand: off.brand, imageUrl: off.imageUrl },
        offStatus: 'off',
      };
    }
    return { found: false, offStatus: off.status };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** "My products": distinct purchased products, newest purchase first. */
  private async listPurchased(
    userId: string,
    q: ListProductsQueryDto,
  ): Promise<ProductListResponse> {
    const limit = q.limit ?? PAGINATION_DEFAULTS.DEFAULT_LIMIT;

    let cursorFilter: { lastPurchasedAt: Date; productId: string } | null = null;
    if (q.cursor) {
      try {
        const payload = decodeCursor(q.cursor);
        const lastPurchasedAt = new Date(String(payload.lastPurchasedAt));
        const productId = String(payload.productId ?? '');
        if (Number.isNaN(lastPurchasedAt.getTime()) || !productId) throw new Error('bad cursor');
        cursorFilter = { lastPurchasedAt, productId };
      } catch {
        throw new BadRequestException({
          message: 'Invalid cursor',
          errorCode: PRODUCT_ERRORS.PRODUCT_MATCH_INVALID,
        });
      }
    }

    // groupBy on the (product_id, purchased_at) index; the keyset filter
    // runs on the grouped aggregate (HAVING) so pagination stays stable.
    const grouped = await this.prisma.receiptItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null }, receipt: { uploadedById: userId, status: 'CONFIRMED' } },
      _count: { _all: true },
      _max: { purchasedAt: true },
      orderBy: [{ _max: { purchasedAt: 'desc' } }, { productId: 'desc' }],
      ...(cursorFilter
        ? {
            having: {
              OR: [
                { purchasedAt: { _max: { lt: cursorFilter.lastPurchasedAt } } },
                {
                  purchasedAt: { _max: { equals: cursorFilter.lastPurchasedAt } },
                  productId: { lt: cursorFilter.productId },
                },
              ],
            },
          }
        : {}),
      take: limit + 1,
    });

    const hasMore = grouped.length > limit;
    const page = hasMore ? grouped.slice(0, limit) : grouped;
    const ids = page.map((g) => g.productId).filter((id): id is string => id !== null);
    if (ids.length === 0) return { data: [], nextCursor: null, hasMore: false };

    const [rows, stats] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: ids } },
        include: PRODUCT_PRIMARY_IMAGE_INCLUDE,
      }),
      this.loadStats(userId, ids),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const last = page[page.length - 1];
    return {
      data: ids
        .map((id) => byId.get(id))
        .filter((row): row is (typeof rows)[number] => row !== undefined)
        .map((row) => mapProductToDto(row, { stats: stats.get(row.id) })),
      nextCursor:
        hasMore && last?.productId && last._max.purchasedAt
          ? encodeCursor({
              lastPurchasedAt: last._max.purchasedAt.toISOString(),
              productId: last.productId,
            })
          : null,
      hasMore,
    };
  }

  /** Caller-scoped stats for a batch of products — two indexed queries. */
  private async loadStats(userId: string, ids: string[]): Promise<Map<string, ProductStatsDto>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.prisma.receiptItem.groupBy({
      by: ['productId'],
      where: {
        productId: { in: ids },
        receipt: { uploadedById: userId, status: 'CONFIRMED' },
      },
      _count: { _all: true },
      _max: { purchasedAt: true },
    });
    const latest = await this.prisma.receiptItem.findMany({
      where: {
        productId: { in: ids },
        receipt: { uploadedById: userId, status: 'CONFIRMED' },
        unitPriceCents: { not: null },
      },
      orderBy: [{ purchasedAt: 'desc' }],
      // Bounded: at worst one page of products × a handful of rows each.
      take: ids.length * 3,
      select: {
        productId: true,
        unitPriceCents: true,
        receipt: { select: { currency: true } },
      },
    });
    const lastPrice = new Map<string, { unitPriceCents: number; currency: string | null }>();
    for (const row of latest) {
      if (row.productId && !lastPrice.has(row.productId) && row.unitPriceCents !== null) {
        lastPrice.set(row.productId, {
          unitPriceCents: row.unitPriceCents,
          currency: row.receipt.currency,
        });
      }
    }
    const out = new Map<string, ProductStatsDto>();
    for (const g of grouped) {
      if (!g.productId) continue;
      const price = lastPrice.get(g.productId);
      out.set(g.productId, {
        timesPurchased: g._count._all,
        lastPurchasedAt: g._max.purchasedAt?.toISOString() ?? null,
        lastUnitPriceCents: price?.unitPriceCents ?? null,
        lastCurrency: price?.currency ?? null,
      });
    }
    return out;
  }

  /** GTIN checksum + uniqueness (excluding self on update). */
  private async validateBarcode(raw: string | null, selfId?: string): Promise<string | null> {
    if (raw === null || raw.trim() === '') return null;
    const barcode = normalizeGtin(raw);
    if (!isValidGtin(barcode)) {
      throw new BadRequestException({
        message: 'Not a valid GTIN-8/12/13/14 barcode',
        errorCode: PRODUCT_ERRORS.PRODUCT_INVALID_BARCODE,
      });
    }
    const existing = await this.prisma.product.findUnique({
      where: { barcode },
      select: { id: true },
    });
    if (existing && existing.id !== selfId) {
      throw new BadRequestException({
        message: 'Another product already carries this barcode',
        errorCode: PRODUCT_ERRORS.PRODUCT_BARCODE_TAKEN,
      });
    }
    return barcode;
  }

  /**
   * A GLOBAL product may only default to a SYSTEM OUT category — private
   * user/group categories would be meaningless (or leaky) for other users.
   */
  private async assertSystemOutCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { ownerType: true, direction: true },
    });
    if (
      !category ||
      category.ownerType !== 'system' ||
      (category.direction !== 'OUT' && category.direction !== 'BOTH')
    ) {
      throw new BadRequestException({
        message: 'Default category must be a system expense category',
        errorCode: PRODUCT_ERRORS.PRODUCT_INVALID_CATEGORY,
      });
    }
  }

  private throwNotFound(): never {
    throw new NotFoundException({
      message: 'Product not found',
      errorCode: PRODUCT_ERRORS.PRODUCT_NOT_FOUND,
    });
  }

  /** Picture-lifecycle audit rows (8.25) — same sink as the other actions. */
  async writeImageAudit(
    userId: string,
    productId: string,
    action: 'PRODUCT_IMAGE_ADDED' | 'PRODUCT_IMAGE_REMOVED' | 'PRODUCT_IMAGE_REORDERED',
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.writeAudit(userId, productId, action, details);
  }

  private async writeAudit(
    userId: string,
    productId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity: 'Product',
          entityId: productId,
          details: details as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write ${action} audit log for product ${productId}: ${(err as Error).message}`,
      );
    }
  }
}
