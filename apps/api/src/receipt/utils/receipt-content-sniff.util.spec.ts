import { looksBinary, sniffBinaryReceipt } from './receipt-content-sniff.util';

describe('sniffBinaryReceipt', () => {
  it('detects PDFs by magic bytes regardless of the header', () => {
    expect(sniffBinaryReceipt('text/html', Buffer.from('%PDF-1.7 rest'))).toEqual({ kind: 'pdf' });
    expect(sniffBinaryReceipt('application/pdf', Buffer.from('no-magic-here'))).toEqual({
      kind: 'pdf',
    });
  });

  it('detects supported images by magic bytes, header only as fallback', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const gif = Buffer.from('GIF89a');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

    expect(sniffBinaryReceipt('text/plain', jpeg)).toEqual({
      kind: 'image',
      mimeType: 'image/jpeg',
    });
    expect(sniffBinaryReceipt('', png)).toEqual({ kind: 'image', mimeType: 'image/png' });
    expect(sniffBinaryReceipt('', gif)).toEqual({ kind: 'image', mimeType: 'image/gif' });
    expect(sniffBinaryReceipt('', webp)).toEqual({ kind: 'image', mimeType: 'image/webp' });
    expect(sniffBinaryReceipt('image/jpeg', Buffer.from('unrecognisable'))).toEqual({
      kind: 'image',
      mimeType: 'image/jpeg',
    });
  });

  it('returns null for HTML and plain text (the dominant online-receipt shape)', () => {
    expect(
      sniffBinaryReceipt('text/html', Buffer.from('<html><body>45.90</body></html>')),
    ).toBeNull();
    expect(sniffBinaryReceipt('text/plain', Buffer.from('Total 45.90'))).toBeNull();
  });
});

describe('looksBinary', () => {
  it('flags NUL bytes and passes real text', () => {
    expect(looksBinary(Buffer.from('BLOB\0\0data'))).toBe(true);
    expect(looksBinary(Buffer.from('Total 45.90 ₪ קבלה'))).toBe(false);
  });
});
