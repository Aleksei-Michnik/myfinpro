import { Injectable } from '@nestjs/common';
import {
  type ReceiptUrlProvider,
  type ResolvedDataUrl,
  type SafeFetch,
} from './receipt-url-provider.interface';

/**
 * Phase 8.17 — Pairzon adapter. Pairzon powers a large share of Israeli
 * retail e-receipts (Rami Levy, Keshet Teamim, …). Its public link
 * (`/<prefix>/<token>`) 302-redirects to an HTML shell
 * (`/<businessId>.html?id=<docId>&p=<prefix>`) that renders the receipt
 * client-side from `GET /v1.0/documents/<docId>?p=<prefix>` (clean JSON).
 * We follow the redirect to learn `docId`+`prefix`, then read that JSON —
 * exactly what the browser does, no headless browser required.
 */
@Injectable()
export class PairzonProvider implements ReceiptUrlProvider {
  readonly name = 'pairzon';

  matches(url: URL): boolean {
    return /(^|\.)pairzon\.com$/i.test(url.hostname);
  }

  async resolveDataUrl(url: URL, fetchSafe: SafeFetch): Promise<ResolvedDataUrl | null> {
    // The public short link doesn't carry the ids; following its redirect
    // yields the canonical `...?id=<docId>&p=<prefix>` URL that does.
    const idParams = (u: URL) => ({
      id: u.searchParams.get('id'),
      p: u.searchParams.get('p'),
    });

    let { id, p } = idParams(url);
    if (!id || !p) {
      const landed = await fetchSafe(url.toString());
      ({ id, p } = idParams(landed.finalUrl));
    }
    if (!id || !p) return null; // format drifted → let the generic path decide

    const apiUrl = new URL(`/v1.0/documents/${encodeURIComponent(id)}`, url);
    apiUrl.searchParams.set('p', p);
    return { dataUrl: apiUrl.toString(), kind: 'json' };
  }
}
