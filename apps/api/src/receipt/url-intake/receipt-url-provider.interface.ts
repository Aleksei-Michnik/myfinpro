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

export interface ReceiptUrlProvider {
  /** Stable identifier recorded in the anonymized intake log. */
  readonly name: string;
  /** True if this adapter knows how to read the given receipt URL. */
  matches(url: URL): boolean;
  /**
   * Return the receipt as a compact, extractable text snapshot — the adapter
   * owns BOTH where the data lives (usually a JSON endpoint reached via
   * `fetchSafe`, following the provider's redirects to discover ids) AND how
   * to reduce it: it must strip the provider's payload down to the receipt
   * essentials (merchant, date, currency, total, per-line name/qty/price),
   * not hand the raw document to the model — the bulk of a provider's JSON is
   * noise that bloats input tokens and truncates the structured output.
   * Return `null` to defer to the generic HTML pipeline (which then applies
   * the JS-shell empty-result guard).
   */
  resolveContent(url: URL, fetchSafe: SafeFetch): Promise<string | null>;
}

export const RECEIPT_URL_PROVIDERS = Symbol('RECEIPT_URL_PROVIDERS');
