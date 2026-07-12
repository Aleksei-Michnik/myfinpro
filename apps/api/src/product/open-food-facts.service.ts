import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OffLookupResult =
  | { status: 'hit'; name: string | null; brand: string | null; imageUrl: string | null }
  | { status: 'miss' }
  | { status: 'unavailable' }
  | { status: 'disabled' };

/** Consecutive failures that open the breaker. */
const BREAKER_FAILURE_THRESHOLD = 3;
/** How long the breaker stays open before a probe is allowed. */
const BREAKER_COOLDOWN_MS = 60_000;
/** Minimum spacing between outbound calls (OFF etiquette — well under their limits). */
const MIN_CALL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Phase 8, iteration 8.7 — Open Food Facts barcode enrichment (design §1.4).
 *
 * Unknown barcodes get a name/brand/image prefill for the create form.
 * Failure NEVER surfaces as an error: a circuit breaker (N consecutive
 * failures → cooldown) plus a minimum call interval keep an OFF outage or
 * a scan-happy user from hammering the API; both degrade to
 * `unavailable`, which the UI renders as plain manual entry.
 *
 * Env: OFF_ENABLED (default true), OFF_BASE_URL (default the public API —
 * override in tests / staging).
 */
@Injectable()
export class OpenFoodFactsService {
  private readonly logger = new Logger(OpenFoodFactsService.name);
  private readonly enabled: boolean;
  private readonly baseUrl: string;

  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;
  private lastCallAt = 0;

  constructor(configService: ConfigService) {
    this.enabled = configService.get<string>('OFF_ENABLED', 'true') !== 'false';
    this.baseUrl =
      configService.get<string>('OFF_BASE_URL', '') || 'https://world.openfoodfacts.org';
  }

  async lookup(barcode: string): Promise<OffLookupResult> {
    if (!this.enabled) return { status: 'disabled' };
    const now = Date.now();
    if (now < this.breakerOpenUntil) return { status: 'unavailable' };
    if (now - this.lastCallAt < MIN_CALL_INTERVAL_MS) return { status: 'unavailable' };
    this.lastCallAt = now;

    try {
      const res = await fetch(
        `${this.baseUrl}/api/v2/product/${encodeURIComponent(barcode)}.json` +
          '?fields=product_name,brands,image_front_url',
        {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { 'User-Agent': 'myfinpro/1.0 (product catalog prefill)' },
        },
      );
      // 404 = clean miss (unknown product), not a failure.
      if (res.status === 404) {
        this.recordSuccess();
        return { status: 'miss' };
      }
      if (!res.ok) throw new Error(`OFF returned ${res.status}`);

      const body = (await res.json()) as {
        status?: number;
        product?: { product_name?: string; brands?: string; image_front_url?: string };
      };
      this.recordSuccess();
      if (body.status !== 1 || !body.product) return { status: 'miss' };
      return {
        status: 'hit',
        name: body.product.product_name?.trim() || null,
        // OFF `brands` is comma-separated; the first entry is the primary.
        brand: body.product.brands?.split(',')[0]?.trim() || null,
        imageUrl: body.product.image_front_url?.trim() || null,
      };
    } catch (err) {
      this.recordFailure(err as Error);
      return { status: 'unavailable' };
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  private recordFailure(err: Error): void {
    this.consecutiveFailures++;
    this.logger.warn(
      `OFF lookup failed (${this.consecutiveFailures}/${BREAKER_FAILURE_THRESHOLD}): ${err.message}`,
    );
    if (this.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
      this.breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
      this.consecutiveFailures = 0;
      this.logger.warn(`OFF circuit breaker open for ${BREAKER_COOLDOWN_MS / 1000}s`);
    }
  }
}
