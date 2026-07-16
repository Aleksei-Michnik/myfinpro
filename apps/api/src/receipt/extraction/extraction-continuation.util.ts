/**
 * Phase 8.21 — chunked extraction for receipts whose JSON exceeds one
 * output window.
 *
 * When a provider stops at its output-token ceiling, the pass's complete
 * line items are salvaged from the truncated JSON and the provider is asked
 * to CONTINUE from the last captured line — so long receipts are extracted
 * in chunks across calls instead of failing, and no generated tokens are
 * thrown away. Both providers share this protocol.
 */

/** Continuation rounds after the first pass — bounds provider spend. */
export const MAX_EXTRACTION_CONTINUATIONS = 4;

/**
 * Pull every COMPLETE item object out of a (possibly truncated) extraction
 * payload. Walks the `items` array with a string-aware brace scanner — the
 * final, cut-off item simply never closes and is dropped.
 */
export function salvageCompleteItems(text: string): Record<string, unknown>[] {
  const key = text.indexOf('"items"');
  if (key === -1) return [];
  const start = text.indexOf('[', key);
  if (start === -1) return [];

  const items: Record<string, unknown>[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          items.push(JSON.parse(text.slice(objStart, i + 1)) as Record<string, unknown>);
        } catch {
          // Malformed slice — skip it; the continuation pass re-extracts it.
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break; // items array closed — nothing was truncated inside it
    }
  }
  return items;
}

/** The follow-up instruction appended to the base prompt on each chunk. */
export function buildContinuationPrompt(
  basePrompt: string,
  extractedCount: number,
  lastRawName: string | null,
): string {
  return [
    basePrompt,
    '',
    `CONTINUATION: a previous pass already extracted the first ${extractedCount} line item(s)` +
      (lastRawName ? ` — the last captured line was "${lastRawName}".` : '.'),
    'Return the SAME JSON schema, but `items` must contain ONLY the remaining line items',
    'AFTER that point, in printed order — do NOT repeat items already extracted.',
    'Still fill the header fields (merchant, date, currency, totals) for the WHOLE receipt.',
    'If no items remain, return an empty items array.',
  ].join('\n');
}

/**
 * Splice salvaged items from earlier truncated passes in front of the final
 * pass's items, preserving printed order. The merged object then goes
 * through the shared validator like any single-pass result.
 */
export function mergeContinuationItems(
  finalPayload: unknown,
  salvagedItems: Record<string, unknown>[],
): unknown {
  if (typeof finalPayload !== 'object' || finalPayload === null || Array.isArray(finalPayload)) {
    return finalPayload;
  }
  const payload = finalPayload as Record<string, unknown>;
  const tail = Array.isArray(payload.items) ? (payload.items as unknown[]) : [];
  return { ...payload, items: [...salvagedItems, ...tail] };
}

/** rawName of the last salvaged item, for the continuation anchor. */
export function lastSalvagedName(items: Record<string, unknown>[]): string | null {
  const last = items[items.length - 1];
  return last && typeof last.rawName === 'string' ? last.rawName : null;
}
