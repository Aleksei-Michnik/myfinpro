/**
 * Phase 7.12 — reduce a fetched HTML receipt page to readable text before it
 * reaches the extraction LLM. Raw markup is mostly noise (scripts, styles,
 * attributes) that crowds the context window and measurably degrades
 * recognition on online receipts.
 *
 * Regex-based on purpose: the output feeds a language model, not a DOM — a
 * best-effort text reduction is all that's needed, and five substitutions do
 * not justify an HTML-parser dependency (DNA: minimal).
 */

/** Character cap on the reduced text handed to the provider. */
export const RECEIPT_TEXT_MAX_CHARS = 100_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shekel: '₪',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * HTML → readable text: drop invisible subtrees (head/script/style/svg/…),
 * turn block-level boundaries into newlines and table cells into tab stops
 * (receipts are usually tables — column alignment carries meaning), strip
 * the remaining tags, decode entities, collapse whitespace, cap the length.
 *
 * Non-HTML input (plain text, JSON receipts) passes through mostly
 * untouched apart from whitespace collapsing and the cap.
 */
export function htmlToReceiptText(html: string, maxChars = RECEIPT_TEXT_MAX_CHARS): string {
  let text = html
    // Comments and invisible subtrees contribute nothing visible.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|head|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // Block boundaries → newlines so items stay on their own lines.
    .replace(
      /<(?:\/?)(?:p|div|li|ul|ol|table|tr|h[1-6]|section|article|header|footer|main|blockquote|pre|dl|dt|dd)\b[^>]*>|<br\s*\/?>/gi,
      '\n',
    )
    // Cell boundaries → tabs so name/qty/price columns stay distinguishable.
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, '\t')
    // Everything else strips to nothing.
    .replace(/<[^>]+>/g, ' ');

  text = decodeEntities(text)
    .replace(/[ \t]*\n[ \t]*/g, '\n') // trim around line breaks
    .replace(/\n{3,}/g, '\n\n') // at most one blank line
    .replace(/[ \t]{2,}/g, '\t') // runs of spaces/tabs → one tab stop
    .trim();

  return text.slice(0, maxChars);
}
