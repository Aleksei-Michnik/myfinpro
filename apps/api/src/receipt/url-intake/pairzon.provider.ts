import { Injectable, Logger } from '@nestjs/common';
import { type ReceiptUrlProvider, type SafeFetch } from './receipt-url-provider.interface';

/**
 * Phase 8.17 — Pairzon adapter. Pairzon powers a large share of Israeli
 * retail e-receipts (Rami Levy, Keshet Teamim, …). Its public link
 * (`/<prefix>/<token>`) 302-redirects to an HTML shell
 * (`/<businessId>.html?id=<docId>&p=<prefix>`) that renders the receipt
 * client-side from `GET /v1.0/documents/<docId>?p=<prefix>` (clean JSON).
 * We follow the redirect to learn `docId`+`prefix`, read that JSON, and
 * REDUCE it to a compact receipt text — the raw document is ~30 KB of noise
 * (hashes, ids, loyalty, per-item category trees) that bloats the model's
 * input and truncates its structured output; only the receipt essentials go
 * to the extractor. Exactly what the browser reads, no headless browser.
 */
@Injectable()
export class PairzonProvider implements ReceiptUrlProvider {
  readonly name = 'pairzon';
  private readonly logger = new Logger(PairzonProvider.name);

  matches(url: URL): boolean {
    return /(^|\.)pairzon\.com$/i.test(url.hostname);
  }

  async resolveContent(url: URL, fetchSafe: SafeFetch): Promise<string | null> {
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
    const res = await fetchSafe(apiUrl.toString());

    const text = pairzonJsonToReceiptText(res.body.toString('utf8'));
    if (!text) {
      this.logger.warn('Pairzon document JSON did not parse — deferring to the generic path');
      return null;
    }
    return text;
  }
}

/** Format a money-ish number to 2 decimals, or '' if it isn't a finite number. */
function money(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '';
}

interface PairzonItem {
  name?: string;
  code?: string;
  quantity?: number;
  price?: number;
  total?: number;
  additionalInfo?: { key?: string; value?: string }[];
}

/**
 * Reduce a Pairzon document JSON to a compact, model-friendly receipt text:
 * merchant + date + currency + total, then one line per item (name, barcode,
 * quantity, unit price, line total, any per-line discount). Deliberately
 * drops loyalty/customer, payment cards, hashes and category trees. Returns
 * `null` if the body isn't the expected JSON (caller defers to generic).
 */
export function pairzonJsonToReceiptText(raw: string): string | null {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;

  const store = (doc.store ?? {}) as Record<string, unknown>;
  const business = (store.business ?? {}) as Record<string, unknown>;
  const merchant = (business.name ?? store.name ?? '') as string;
  const branch = (store.name ?? '') as string;
  const address = (store.address ?? '') as string;
  const currency = (business.currency ?? 'ILS') as string;
  const items = (Array.isArray(doc.items) ? doc.items : []) as PairzonItem[];

  const lines: string[] = ['Pairzon e-receipt'];
  if (merchant)
    lines.push(
      `Merchant: ${merchant}${branch && branch !== merchant ? ` (branch: ${branch})` : ''}`,
    );
  if (address) lines.push(`Address: ${address}`);
  if (doc.createdDate) lines.push(`Date: ${String(doc.createdDate)}`);
  lines.push(`Currency: ${currency}`);
  const total = money(doc.total);
  if (total) {
    const noVat = money(doc.totalNoVat);
    const vat = money(doc.totalVat);
    lines.push(`Total: ${total}${noVat && vat ? ` (excl. VAT ${noVat}, VAT ${vat})` : ''}`);
  }

  lines.push(`Items: ${items.length}`);
  items.forEach((item, i) => {
    const parts = [`${i + 1}. ${(item.name ?? '').trim() || '(unnamed)'}`];
    if (item.code) parts.push(`barcode ${item.code}`);
    if (typeof item.quantity === 'number') parts.push(`qty ${item.quantity}`);
    const unit = money(item.price);
    if (unit) parts.push(`unit ${unit}`);
    const line = money(item.total);
    if (line) parts.push(`line ${line}`);
    const discounts = (item.additionalInfo ?? [])
      .filter((a) => a && a.value)
      .map((a) => `${a.value}${a.key ? ` (${a.key.trim()})` : ''}`);
    if (discounts.length > 0) parts.push(`discount ${discounts.join('; ')}`);
    lines.push(parts.join(' | '));
  });

  return lines.join('\n');
}
