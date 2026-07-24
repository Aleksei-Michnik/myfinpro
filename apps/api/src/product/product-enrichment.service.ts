import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PRODUCT_ENRICHMENTS_QUEUE } from '../queue/queue.constants';
import { OFF_MIN_CALL_INTERVAL_MS, OpenFoodFactsService } from './open-food-facts.service';
import { ProductImageService } from './product-image.service';
import { ProductService } from './product.service';

/** Nightly, in the server's quiet hours (03:10 keeps clear of other crons). */
const ENRICHMENT_CRON = '10 3 * * *';
/** Products swept per run — a large backlog drains over a few nights. */
const BATCH_LIMIT = 200;
/** One scheduler for the whole deployment; the id makes the upsert idempotent. */
const SCHEDULER_ID = 'product-enrichment-nightly';
export const PRODUCT_ENRICHMENT_JOB = 'enrich-unchecked';

export interface EnrichmentSummary {
  /** Products whose barcode was actually sent to OFF this run. */
  scanned: number;
  /** OFF hits — gaps filled (brand/alias/image) and marked checked. */
  enriched: number;
  /** Clean OFF misses — marked checked so they are not re-asked nightly. */
  missed: number;
  /** True when OFF became unavailable and the run stopped early. */
  halted: boolean;
}

/**
 * Nightly Open Food Facts enrichment (design §1.4).
 *
 * Products can reach the registry without ever meeting the barcode checker
 * (manual create with a typed code, walkthrough create, codes added by
 * edit). This job sweeps every product whose barcode was never checked
 * (`offCheckedAt` null) and enriches it from OFF — filling only the gaps:
 * a missing brand, the OFF name as an 'off'-source alias, a primary image
 * when the product has none. Hit or miss, the product is stamped checked;
 * an OFF outage halts the run and leaves the remainder for the next night.
 *
 * Pacing mirrors the OFF client's own etiquette throttle, so a batch never
 * trips it. Scheduling rides BullMQ's job scheduler under a deterministic
 * id — safe across restarts and blue/green overlap.
 */
@Injectable()
export class ProductEnrichmentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly off: OpenFoodFactsService,
    private readonly products: ProductService,
    private readonly images: ProductImageService,
    @InjectQueue(PRODUCT_ENRICHMENTS_QUEUE)
    private readonly queue: Queue,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.off.isEnabled) {
      this.logger.log('OFF disabled — nightly product enrichment not scheduled');
      return;
    }
    void this.queue
      .upsertJobScheduler(
        SCHEDULER_ID,
        { pattern: ENRICHMENT_CRON },
        {
          name: PRODUCT_ENRICHMENT_JOB,
          opts: { removeOnComplete: 20, removeOnFail: 50 },
        },
      )
      .then(() =>
        this.logger.log(`Nightly product enrichment scheduled (cron '${ENRICHMENT_CRON}')`),
      )
      .catch((err: Error) =>
        this.logger.error(`Failed to schedule nightly product enrichment: ${err.message}`),
      );
  }

  /** Worker entry — one nightly sweep. */
  async enrichUnchecked(): Promise<EnrichmentSummary> {
    const rows = await this.prisma.product.findMany({
      where: { barcode: { not: null }, offCheckedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
      select: {
        id: true,
        barcode: true,
        brand: true,
        images: { take: 1, select: { id: true } },
      },
    });

    const summary: EnrichmentSummary = { scanned: 0, enriched: 0, missed: 0, halted: false };
    for (const [index, row] of rows.entries()) {
      // Same rhythm as the OFF client's throttle — never trip it.
      if (index > 0) await sleep(OFF_MIN_CALL_INTERVAL_MS + 100);

      const res = await this.off.lookup(row.barcode!);
      if (res.status === 'disabled' || res.status === 'unavailable') {
        // Outage/disabled: nothing is stamped, the rest waits for the next
        // night — the sweep is self-resuming by construction.
        summary.halted = true;
        this.logger.warn(
          `Product enrichment halted (OFF ${res.status}) after ${summary.scanned} of ${rows.length}`,
        );
        return summary;
      }

      summary.scanned++;
      const data: Prisma.ProductUpdateInput = { offCheckedAt: new Date() };
      if (res.status === 'hit') {
        if (!row.brand && res.brand) data.brand = res.brand;
        summary.enriched++;
      } else {
        summary.missed++;
      }
      await this.prisma.product.update({ where: { id: row.id }, data });
      if (res.status === 'hit') {
        // The OFF name becomes an alias (never overwrites the user-facing
        // name) — recordAlias audits with a null user: a system action.
        if (res.name) {
          await this.products.recordAlias(this.prisma, null, row.id, res.name, null, 'off');
        }
        if (row.images.length === 0 && res.imageUrl) {
          await this.images.addFromUrl(row.id, res.imageUrl);
        }
      }
    }

    if (rows.length > 0) {
      this.logger.log(
        `Product enrichment: ${summary.enriched} enriched, ${summary.missed} misses ` +
          `of ${summary.scanned} scanned`,
      );
    }
    return summary;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
