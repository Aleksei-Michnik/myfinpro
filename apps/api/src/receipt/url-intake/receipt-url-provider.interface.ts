/**
 * Phase 8.17 — provider adapters for online-receipt URLs.
 *
 * Many e-receipt pages are client-side-rendered SPAs: a plain server-side
 * fetch gets an empty HTML shell while the real receipt loads over XHR. An
 * adapter recognises such a provider and points the fetcher at the actual
 * data endpoint (usually a clean JSON document) instead of the shell.
 */

/** Result of a single SSRF-guarded, redirect-following fetch. */
export interface SafeFetchResult {
  /** The URL after following redirects (carries any id/prefix query params). */
  finalUrl: URL;
  contentType: string;
  body: Buffer;
}

/** Fetch primitive handed to adapters — SSRF-guarded + size-capped. */
export type SafeFetch = (url: string) => Promise<SafeFetchResult>;

/** Where an adapter says the extractable data actually lives. */
export interface ResolvedDataUrl {
  dataUrl: string;
  /** 'json'/'text' skip binary sniffing; 'auto' runs the normal pipeline. */
  kind: 'json' | 'auto';
}

export interface ReceiptUrlProvider {
  /** Stable identifier recorded in the anonymized intake log. */
  readonly name: string;
  /** True if this adapter knows how to read the given receipt URL. */
  matches(url: URL): boolean;
  /**
   * Resolve the URL that actually returns extractable receipt data. May use
   * `fetchSafe` to follow the provider's redirects and discover ids. Return
   * `null` to defer to the generic HTML pipeline (which then applies the
   * JS-shell guard).
   */
  resolveDataUrl(url: URL, fetchSafe: SafeFetch): Promise<ResolvedDataUrl | null>;
}

export const RECEIPT_URL_PROVIDERS = Symbol('RECEIPT_URL_PROVIDERS');
