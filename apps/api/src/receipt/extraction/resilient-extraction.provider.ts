import type { ExtractionResult } from '@myfinpro/shared';
import { Logger } from '@nestjs/common';
import {
  ExtractionFailedError,
  type ExtractionContext,
  type ExtractionInput,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';

export interface ResilienceOptions {
  /** Total attempts per extract() call (default 3). */
  attempts?: number;
  /** First backoff delay; doubles per retry (default 2s; tests pass 1ms). */
  baseDelayMs?: number;
  /** Consecutive failures before the breaker opens (default 5). */
  breakerThreshold?: number;
  /** How long the breaker stays open before a half-open probe (default 60s). */
  breakerCooldownMs?: number;
}

/**
 * Phase 7, iteration 7.5 — retry + circuit-breaker decorator around any
 * provider (§3.4 of the plan's cross-cutting rules: retry with exponential
 * backoff + circuit breaker for external APIs).
 *
 * - `ExtractionFailedError` is PERMANENT: no retry, doesn't trip the
 *   breaker (bad input ≠ unhealthy provider).
 * - Everything else (network, 429/5xx) retries with exponential backoff and
 *   counts toward the breaker. While open, calls fail fast so a provider
 *   outage doesn't stall the whole queue; after the cooldown one probe call
 *   is let through (half-open) and success closes the breaker.
 */
export class ResilientExtractionProvider implements ReceiptExtractionProvider {
  private readonly logger = new Logger(ResilientExtractionProvider.name);
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;

  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly inner: ReceiptExtractionProvider,
    options: ResilienceOptions = {},
  ) {
    this.attempts = options.attempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
    this.breakerThreshold = options.breakerThreshold ?? 5;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 60_000;
  }

  get name(): string {
    return this.inner.name;
  }

  async extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult> {
    if (this.openedAt !== null) {
      if (Date.now() - this.openedAt < this.breakerCooldownMs) {
        throw new Error(`Extraction provider '${this.name}' circuit breaker is open`);
      }
      // Half-open: let exactly this call probe; state resolves on outcome.
      this.logger.warn(`Circuit breaker half-open for '${this.name}' — probing`);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const result = await this.inner.extract(input, ctx);
        this.consecutiveFailures = 0;
        this.openedAt = null;
        return result;
      } catch (err) {
        if (err instanceof ExtractionFailedError) {
          // Permanent — the caller fails the receipt; provider stays healthy.
          throw err;
        }
        lastError = err;
        this.logger.warn(
          `Extraction attempt ${attempt}/${this.attempts} failed on '${this.name}': ${
            (err as Error).message
          }`,
        );
        if (attempt < this.attempts) {
          await new Promise((r) => setTimeout(r, this.baseDelayMs * 2 ** (attempt - 1)));
        }
      }
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.openedAt = Date.now();
      this.logger.error(
        `Circuit breaker OPEN for '${this.name}' after ${this.consecutiveFailures} consecutive failed calls`,
      );
    }
    throw lastError;
  }
}
