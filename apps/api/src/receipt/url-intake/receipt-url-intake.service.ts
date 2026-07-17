import { RECEIPT_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExtractionFailedError,
  type ExtractionInput,
} from '../extraction/extraction-provider.interface';
import { htmlToReceiptText } from '../utils/html-to-text.util';
import { looksBinary, sniffBinaryReceipt } from '../utils/receipt-content-sniff.util';
import { assertPublicReceiptUrl, UnsafeReceiptUrlError } from '../utils/receipt-url-guard.util';
import {
  RECEIPT_URL_PROVIDERS,
  type ReceiptUrlProvider,
  type SafeFetchResult,
} from './receipt-url-provider.interface';

/** Cap for fetched URL snapshots handed to the provider. */
const URL_SNAPSHOT_MAX_CHARS = 500_000;
const URL_FETCH_TIMEOUT_MS = 20_000;
/** Redirect hops the fetcher will follow (each re-validated by the SSRF guard). */
const URL_MAX_REDIRECTS = 5;

/**
 * Per-external-host politeness (design §8.17): across ALL users, at most
 * this many fetches to one host within the window. Protects our egress from
 * a provider's own abuse guards — one user pasting many links (or several
 * users hitting the same provider) can't get our IP blocked for everyone.
 */
const HOST_WINDOW_MS = 60_000;
const HOST_MAX_PER_WINDOW = 30;

export type IntakeOutcome =
  | 'provider_ok'
  | 'fetched'
  | 'binary_pdf'
  | 'binary_image'
  | 'binary_unsupported'
  | 'empty_result'
  | 'throttled'
  | 'error';

/**
 * Phase 8.17 — resolves an online-receipt URL to extractable content.
 *
 * Order: provider adapter (points at the real JSON data endpoint for
 * client-rendered SPAs) → generic fetch (PDF/image → native inputs; HTML →
 * readable text). Every attempt is recorded in an anonymized, user-unlinked
 * log used to spot frequent providers (adapter candidates) and to rate-limit
 * our egress per host.
 */
@Injectable()
export class ReceiptUrlIntakeService {
  private readonly logger = new Logger(ReceiptUrlIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RECEIPT_URL_PROVIDERS) private readonly providers: ReceiptUrlProvider[],
  ) {}

  /** Resolve the receipt URL to extraction input (throws on bad/empty input). */
  async resolve(url: string): Promise<ExtractionInput> {
    let target: URL;
    try {
      target = assertPublicReceiptUrl(url);
    } catch (err) {
      throw new ExtractionFailedError(
        err instanceof UnsafeReceiptUrlError ? err.message : 'Invalid receipt URL',
      );
    }

    await this.enforceHostPoliteness(target.hostname, url);

    const provider = this.providers.find((p) => p.matches(target));
    const fetchSafe = (u: string) => this.safeFetch(u);

    if (provider) {
      try {
        // The adapter returns the receipt already reduced to a compact text
        // snapshot (it owns the provider's data endpoint AND its shape).
        const content = await provider.resolveContent(target, fetchSafe);
        if (content !== null) {
          await this.record(target, provider.name, 'provider_ok');
          this.logger.log(`Receipt URL resolved via '${provider.name}' adapter`);
          return { kind: 'html', data: content.slice(0, URL_SNAPSHOT_MAX_CHARS), sourceUrl: url };
        }
        // Adapter deferred → fall through to the generic path.
      } catch (err) {
        if (err instanceof ExtractionFailedError) throw err;
        // A provider glitch shouldn't sink the receipt — try the generic path.
        this.logger.warn(
          `Provider '${provider.name}' failed, falling back: ${(err as Error).message}`,
        );
      }
    }

    return this.resolveGeneric(target, url);
  }

  /** Generic path: fetch → route PDF/image to native inputs, HTML to text. */
  private async resolveGeneric(target: URL, originalUrl: string): Promise<ExtractionInput> {
    const res = await this.safeFetch(target.toString());

    const binary = sniffBinaryReceipt(res.contentType, res.body);
    if (binary?.kind === 'pdf') {
      await this.record(target, null, 'binary_pdf');
      return { kind: 'pdf', data: res.body };
    }
    if (binary?.kind === 'image') {
      await this.record(target, null, 'binary_image');
      return { kind: 'image', pages: [{ data: res.body, mimeType: binary.mimeType }] };
    }
    if (looksBinary(res.body)) {
      await this.record(target, null, 'binary_unsupported');
      throw new ExtractionFailedError(
        'Receipt URL returned an unsupported file type (expected a web page, PDF or image)',
      );
    }

    const text = this.reduceHtml(res.body, res.contentType);
    await this.record(target, null, 'fetched');
    return { kind: 'html', data: text.slice(0, URL_SNAPSHOT_MAX_CHARS), sourceUrl: originalUrl };
  }

  private reduceHtml(body: Buffer, contentType: string): string {
    const raw = body.toString('utf8');
    const looksLikeHtml =
      contentType.includes('html') || /^\s*(?:<!doctype\s+html|<html)/i.test(raw);
    return looksLikeHtml ? htmlToReceiptText(raw) : raw;
  }

  /**
   * SSRF-guarded fetch with manual redirect following (a `redirect: 'follow'`
   * would let a public URL bounce to an internal address unchecked) and the
   * shared size cap. Transient network/5xx → plain Error (BullMQ retry);
   * unsafe targets and 4xx → permanent ExtractionFailedError.
   */
  private async safeFetch(url: string): Promise<SafeFetchResult> {
    let current: URL;
    try {
      current = assertPublicReceiptUrl(url);
    } catch (err) {
      throw new ExtractionFailedError(
        err instanceof UnsafeReceiptUrlError ? err.message : 'Invalid receipt URL',
      );
    }

    for (let hop = 0; hop <= URL_MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: { 'User-Agent': 'myfinpro-receipt-fetcher/1.0' },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new ExtractionFailedError('Redirect without a Location header');
        if (hop === URL_MAX_REDIRECTS) throw new ExtractionFailedError('Too many redirects');
        try {
          current = assertPublicReceiptUrl(new URL(location, current).toString());
        } catch (err) {
          throw new ExtractionFailedError(
            err instanceof UnsafeReceiptUrlError ? err.message : 'Invalid redirect target',
          );
        }
        continue;
      }

      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          throw new ExtractionFailedError(`Receipt URL returned ${res.status}`);
        }
        throw new Error(`Receipt URL fetch failed (${res.status})`);
      }

      const body = Buffer.from(await res.arrayBuffer());
      if (body.byteLength > RECEIPT_MAX_FILE_SIZE_BYTES) {
        throw new ExtractionFailedError(
          `Receipt URL content exceeds the ${Math.round(RECEIPT_MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB limit`,
        );
      }
      return {
        finalUrl: current,
        contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
        body,
      };
    }
    // Unreachable — the loop returns or throws — but satisfies the type checker.
    throw new ExtractionFailedError('Too many redirects');
  }

  /** Throw a transient error if we're fetching this host too often. */
  private async enforceHostPoliteness(host: string, url: string): Promise<void> {
    const since = new Date(Date.now() - HOST_WINDOW_MS);
    const recent = await this.prisma.receiptUrlIntake
      .count({ where: { host, createdAt: { gte: since } } })
      .catch(() => 0);
    if (recent >= HOST_MAX_PER_WINDOW) {
      await this.record(new URL(url), null, 'throttled');
      this.logger.warn(`Host politeness limit hit for ${host} (${recent}/${HOST_MAX_PER_WINDOW})`);
      // Transient — BullMQ backs off and retries, spreading the load out.
      throw new Error(`Too many recent fetches to ${host}; backing off`);
    }
  }

  /**
   * Record an anonymized intake event. Deliberately user-unlinked; the path
   * is masked to its SHAPE (token/id segments → placeholders) so we keep the
   * analyzable pattern without hoarding live receipt bearer-links.
   */
  async record(url: URL, provider: string | null, outcome: IntakeOutcome): Promise<void> {
    try {
      await this.prisma.receiptUrlIntake.create({
        data: {
          host: url.hostname.slice(0, 255),
          pathTemplate: maskPath(url.pathname).slice(0, 500),
          provider,
          outcome,
        } satisfies Prisma.ReceiptUrlIntakeUncheckedCreateInput,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record URL intake for ${url.hostname}: ${(err as Error).message}`,
      );
    }
  }

  /** Record an outcome from a raw URL string (best-effort — never throws). */
  async recordUrlOutcome(
    url: string,
    provider: string | null,
    outcome: IntakeOutcome,
  ): Promise<void> {
    try {
      await this.record(new URL(url), provider, outcome);
    } catch {
      // Unparseable URL — nothing useful to log.
    }
  }
}

/**
 * Mask a URL path to its structural template: segments that look like ids or
 * opaque tokens (long, or containing digits) become `:token`, so
 * `/1331/3s70TWnbWeywEHEs5MPR05` → `/:token/:token` and
 * `/0351...html` → `/:token`. Keeps short, wordy segments (`/receipt`,
 * `/v1.0`) that identify the provider's URL shape.
 */
export function maskPath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  const masked = segments.map((seg) => {
    const bare = seg.replace(/\.[a-z0-9]+$/i, ''); // ignore a trailing file extension
    const mixedCase = /[a-z]/.test(bare) && /[A-Z]/.test(bare);
    const looksOpaque = bare.length > 12 || /\d/.test(bare) || (mixedCase && bare.length > 8);
    return looksOpaque ? ':token' : seg.toLowerCase();
  });
  return '/' + masked.join('/');
}
