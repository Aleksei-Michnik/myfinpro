import {
  isValidGtin,
  normalizeGtin,
  normalizeLookupName,
  PRODUCT_AUTO_MATCH_THRESHOLD,
  PRODUCT_NAME_MAX_LENGTH,
  type ProductMatchCandidate,
} from '@myfinpro/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fuzzyLookupTokens, trigramSimilarity } from './utils/trigram.util';

/** Confidence per deterministic stage (design §1.2). */
const BARCODE_CONFIDENCE = 1.0;
const ALIAS_BASE_CONFIDENCE = 0.95;
/** Each confirmation adds a hair of confidence, capped just under barcode. */
const ALIAS_CONFIRMATION_BONUS = 0.005;
const ALIAS_MAX_CONFIDENCE = 0.99;
const EXACT_CONFIDENCE = 0.9;
/** Fuzzy floor/ceiling — never auto-links (design §1.2). */
const FUZZY_MIN_SIMILARITY = 0.35;
const FUZZY_MAX_CONFIDENCE = 0.85;
/** LLM proposal confidence by extraction confidence. */
const LLM_CONFIDENCE = { high: 0.8, medium: 0.65, low: 0.5 } as const;

/** Hard caps so matching cost never grows with registry size (design §6). */
const FUZZY_POOL_LIMIT = 300;
const CANDIDATES_PER_ITEM = 5;
/** Product candidates injected into the extraction prompt (design §1.2). */
const LLM_CANDIDATE_LIMIT = 150;

export interface MatchProposal {
  candidates: ProductMatchCandidate[];
  /** Set when the top candidate is deterministic and ≥ the auto threshold. */
  autoProductId: string | null;
}

interface PooledName {
  productId: string;
  normalizedName: string;
  /** Alias confirmation weight (0 for canonical product names). */
  confirmationCount: number;
}

type ProductHead = { id: string; name: string; brand: string | null };

/**
 * Phase 8, iteration 8.3 — the staged product matcher (design §1.2).
 *
 * Batch-first by construction: `matchItems` issues ONE alias query, ONE
 * product query and ONE prefiltered fuzzy-pool query per receipt, then
 * scores in-process — matching cost is bounded by the caps above, not by
 * registry size or item count.
 */
@Injectable()
export class ProductMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Products worth offering the extraction LLM for cross-language ranking:
   * the uploader's most recently purchased products (their receipts are the
   * only context in the call), capped. Returns id + display strings only.
   */
  async getUserProductCandidates(
    userId: string,
  ): Promise<{ id: string; name: string; brand: string | null }[]> {
    const recent = await this.prisma.receiptItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null }, receipt: { uploadedById: userId } },
      _max: { purchasedAt: true },
      orderBy: { _max: { purchasedAt: 'desc' } },
      take: LLM_CANDIDATE_LIMIT,
    });
    const ids = recent.map((r) => r.productId).filter((id): id is string => id !== null);
    if (ids.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, brand: true },
    });
    // Preserve the recency order groupBy produced.
    const byId = new Map(products.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is ProductHead => p !== undefined);
  }

  /**
   * Stage-match a batch of raw item names (+ optional per-item extracted
   * barcodes and LLM suggestions validated by the caller against the
   * injected candidate list). Returns one proposal per input, index-aligned.
   */
  async matchItems(
    items: { rawName: string; barcode?: string | null; suggestedProductId?: string | null }[],
    extractionConfidence: 'high' | 'medium' | 'low' = 'medium',
  ): Promise<MatchProposal[]> {
    if (items.length === 0) return [];

    const normalizedNames = items.map((item) =>
      normalizeLookupName(item.rawName, PRODUCT_NAME_MAX_LENGTH),
    );
    const distinctNames = [...new Set(normalizedNames)].filter((n) => n.length > 0);

    // ── Stage 1 pool (8.21): printed product codes, exact GTIN hits.
    // The GS1 checksum gate also drops most OCR misreads — and only
    // checksum-valid codes exist on Product.barcode anyway. ──
    const normalizedBarcodes = items.map((item) =>
      item.barcode ? normalizeGtin(item.barcode) : '',
    );
    const distinctBarcodes = [...new Set(normalizedBarcodes)].filter((b) => isValidGtin(b));
    const barcodeRows =
      distinctBarcodes.length > 0
        ? await this.prisma.product.findMany({
            where: { barcode: { in: distinctBarcodes } },
            select: { id: true, barcode: true },
          })
        : [];
    const byBarcode = new Map(barcodeRows.map((row) => [row.barcode!, row.id]));

    // ── Stage 2 pool: confirmed aliases, exact normalized hits ──
    const aliasRows =
      distinctNames.length > 0
        ? await this.prisma.productAlias.findMany({
            where: { normalizedName: { in: distinctNames } },
            select: { productId: true, normalizedName: true, confirmationCount: true },
          })
        : [];
    const aliasByName = new Map<string, { productId: string; confirmationCount: number }>();
    for (const row of aliasRows) {
      const prev = aliasByName.get(row.normalizedName);
      if (!prev || row.confirmationCount > prev.confirmationCount) {
        aliasByName.set(row.normalizedName, row);
      }
    }

    // ── Stage 3 pool: canonical names, exact normalized hits ──
    const exactRows =
      distinctNames.length > 0
        ? await this.prisma.product.findMany({
            where: { normalizedName: { in: distinctNames } },
            select: { id: true, normalizedName: true },
          })
        : [];
    const exactByName = new Map(exactRows.map((row) => [row.normalizedName, row.id]));

    // ── Stage 4 pool: token-prefiltered LIKE scan, scored in-process ──
    const tokens = new Set<string>();
    for (const name of distinctNames) {
      for (const token of fuzzyLookupTokens(name)) tokens.add(token);
    }
    const fuzzyPool = await this.loadFuzzyPool([...tokens]);

    // ── LLM suggestions (stage 5) need display data ──
    const llmIds = [
      ...new Set(items.map((i) => i.suggestedProductId).filter((id): id is string => !!id)),
    ];

    // One head fetch for every product any stage produced.
    const headIds = new Set<string>(llmIds);
    for (const id of byBarcode.values()) headIds.add(id);
    for (const row of aliasByName.values()) headIds.add(row.productId);
    for (const id of exactByName.values()) headIds.add(id);
    for (const row of fuzzyPool) headIds.add(row.productId);
    const heads = new Map<string, ProductHead>(
      headIds.size > 0
        ? (
            await this.prisma.product.findMany({
              where: { id: { in: [...headIds] } },
              select: { id: true, name: true, brand: true },
            })
          ).map((p) => [p.id, p])
        : [],
    );

    return items.map((item, index) => {
      const normalized = normalizedNames[index];
      const byProduct = new Map<string, ProductMatchCandidate>();
      const offer = (productId: string, stage: ProductMatchCandidate['stage'], conf: number) => {
        const head = heads.get(productId);
        if (!head) return;
        const existing = byProduct.get(productId);
        if (existing && existing.confidence >= conf) return;
        byProduct.set(productId, {
          productId,
          name: head.name,
          brand: head.brand,
          stage,
          confidence: Math.round(conf * 1000) / 1000,
        });
      };

      const barcodeId = byBarcode.get(normalizedBarcodes[index]);
      if (barcodeId) offer(barcodeId, 'barcode', BARCODE_CONFIDENCE);

      const alias = aliasByName.get(normalized);
      if (alias) {
        offer(
          alias.productId,
          'alias',
          Math.min(
            ALIAS_MAX_CONFIDENCE,
            ALIAS_BASE_CONFIDENCE + alias.confirmationCount * ALIAS_CONFIRMATION_BONUS,
          ),
        );
      }
      const exactId = exactByName.get(normalized);
      if (exactId) offer(exactId, 'exact', EXACT_CONFIDENCE);

      if (normalized) {
        for (const pooled of fuzzyPool) {
          const similarity = trigramSimilarity(normalized, pooled.normalizedName);
          if (similarity < FUZZY_MIN_SIMILARITY) continue;
          offer(pooled.productId, 'fuzzy', Math.min(FUZZY_MAX_CONFIDENCE, similarity));
        }
      }

      if (item.suggestedProductId) {
        offer(item.suggestedProductId, 'llm', LLM_CONFIDENCE[extractionConfidence]);
      }

      const candidates = [...byProduct.values()]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, CANDIDATES_PER_ITEM);

      const top = candidates[0];
      const autoProductId =
        top &&
        (top.stage === 'barcode' || top.stage === 'alias' || top.stage === 'exact') &&
        top.confidence >= PRODUCT_AUTO_MATCH_THRESHOLD
          ? top.productId
          : null;

      return { candidates, autoProductId };
    });
  }

  /**
   * Single-name matching for interactive registry search: same stages,
   * ranked union (alias/exact first, then fuzzy), no auto-link semantics.
   */
  async searchRegistry(query: string, limit = 20): Promise<ProductMatchCandidate[]> {
    const barcode = normalizeGtin(query);
    if (/^\d{8,14}$/.test(barcode)) {
      const product = await this.prisma.product.findUnique({
        where: { barcode },
        select: { id: true, name: true, brand: true },
      });
      if (product) {
        return [
          {
            productId: product.id,
            name: product.name,
            brand: product.brand,
            stage: 'barcode',
            confidence: BARCODE_CONFIDENCE,
          },
        ];
      }
    }
    const [proposal] = await this.matchItems([{ rawName: query }]);
    if (!proposal) return [];
    // Interactive search benefits from a broader fuzzy net than the
    // walkthrough's top-5; re-rank with a contains bonus for prefix typing.
    const normalized = normalizeLookupName(query, PRODUCT_NAME_MAX_LENGTH);
    const contains =
      normalized.length >= 2
        ? await this.prisma.product.findMany({
            where: { normalizedName: { contains: normalized } },
            select: { id: true, name: true, brand: true },
            take: limit,
          })
        : [];
    const merged = new Map(proposal.candidates.map((c) => [c.productId, c]));
    for (const product of contains) {
      const existing = merged.get(product.id);
      if (!existing || existing.confidence < EXACT_CONFIDENCE) {
        merged.set(product.id, {
          productId: product.id,
          name: product.name,
          brand: product.brand,
          stage: existing?.stage ?? 'fuzzy',
          confidence: Math.max(existing?.confidence ?? 0, 0.6),
        });
      }
    }
    return [...merged.values()].sort((a, b) => b.confidence - a.confidence).slice(0, limit);
  }

  /**
   * Fuzzy candidate pool: alias + canonical names sharing an indexed token
   * prefix/substring with any input name, hard-capped (design §6).
   */
  private async loadFuzzyPool(tokens: string[]): Promise<PooledName[]> {
    if (tokens.length === 0) return [];
    const perSourceCap = Math.ceil(FUZZY_POOL_LIMIT / 2);
    const [aliases, products] = await Promise.all([
      this.prisma.productAlias.findMany({
        where: { OR: tokens.map((token) => ({ normalizedName: { contains: token } })) },
        select: { productId: true, normalizedName: true, confirmationCount: true },
        take: perSourceCap,
      }),
      this.prisma.product.findMany({
        where: { OR: tokens.map((token) => ({ normalizedName: { contains: token } })) },
        select: { id: true, normalizedName: true },
        take: perSourceCap,
      }),
    ]);
    return [
      ...aliases,
      ...products.map((p) => ({
        productId: p.id,
        normalizedName: p.normalizedName,
        confirmationCount: 0,
      })),
    ];
  }
}
