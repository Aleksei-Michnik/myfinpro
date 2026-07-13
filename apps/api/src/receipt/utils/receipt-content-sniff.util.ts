/**
 * Phase 8.12 — content detection for URL-sourced receipts.
 *
 * E-receipt links from text messages frequently serve a PDF or an image
 * directly rather than an HTML page — and just as frequently mislabel the
 * Content-Type — so the header is only a hint: magic bytes win. Detected
 * binaries route to the extraction pipeline's native `pdf`/`image` inputs
 * (the same path as direct uploads) instead of being mangled through the
 * text snapshot.
 */

export type SniffedBinaryReceipt = { kind: 'pdf' } | { kind: 'image'; mimeType: string };

/** Vision-provider-supported image formats, by leading magic bytes. */
const IMAGE_MAGIC: Array<{ mimeType: string; test(body: Buffer): boolean }> = [
  {
    mimeType: 'image/jpeg',
    test: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  { mimeType: 'image/png', test: (b) => b.length > 3 && b.readUInt32BE(0) === 0x89504e47 },
  { mimeType: 'image/gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    mimeType: 'image/webp',
    test: (b) =>
      b.length > 11 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** Detects a PDF or supported image; null means "treat as text/HTML". */
export function sniffBinaryReceipt(contentType: string, body: Buffer): SniffedBinaryReceipt | null {
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf' };
  const byMagic = IMAGE_MAGIC.find((m) => m.test(body));
  if (byMagic) return { kind: 'image', mimeType: byMagic.mimeType };
  // Header fallback for streams whose magic we don't recognise but whose
  // declared type is one we support anyway.
  if (contentType.includes('application/pdf')) return { kind: 'pdf' };
  const header = /^image\/(jpeg|png|gif|webp)/.exec(contentType);
  if (header) return { kind: 'image', mimeType: `image/${header[1]}` };
  return null;
}

/** Cheap binary-vs-text heuristic: a NUL byte never appears in real text. */
export function looksBinary(body: Buffer): boolean {
  return body.subarray(0, 1024).includes(0);
}
