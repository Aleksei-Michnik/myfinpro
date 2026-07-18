import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_ACCEPT,
  RECEIPT_ACCEPT,
  uploadRejectionMessage,
  validateUploadFiles,
} from './upload';

const file = (name: string, type: string, bytes = 4) =>
  new File([new Uint8Array(bytes)], name, { type });

const MB = 1024 * 1024;

describe('upload validation (8.27)', () => {
  it('RECEIPT_ACCEPT is IMAGE_ACCEPT plus PDF (derived, not duplicated)', () => {
    expect(RECEIPT_ACCEPT).toBe(`${IMAGE_ACCEPT},application/pdf`);
  });

  it('accepts files matching the accept list and under the size cap', () => {
    const jpeg = file('a.jpg', 'image/jpeg');
    const heic = file('b.heic', 'image/heic');
    const { accepted, rejected } = validateUploadFiles([jpeg, heic], {
      accept: IMAGE_ACCEPT,
      maxBytes: MB,
    });
    expect(accepted).toEqual([jpeg, heic]);
    expect(rejected).toEqual([]);
  });

  it('rejects disallowed types with reason "type"', () => {
    const gif = file('x.gif', 'image/gif');
    const pdf = file('x.pdf', 'application/pdf');
    const { accepted, rejected } = validateUploadFiles([gif, pdf], {
      accept: IMAGE_ACCEPT,
      maxBytes: MB,
    });
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([
      { file: gif, reason: 'type' },
      { file: pdf, reason: 'type' },
    ]);
  });

  it('the same PDF passes the receipt accept list', () => {
    const pdf = file('slip.pdf', 'application/pdf');
    expect(validateUploadFiles([pdf], { accept: RECEIPT_ACCEPT, maxBytes: MB }).accepted).toEqual([
      pdf,
    ]);
  });

  it('rejects oversize files with reason "size" (type wins when both fail)', () => {
    const big = file('big.png', 'image/png', 10);
    const bigWrong = file('big.gif', 'image/gif', 10);
    const { rejected } = validateUploadFiles([big, bigWrong], {
      accept: IMAGE_ACCEPT,
      maxBytes: 5,
    });
    expect(rejected).toEqual([
      { file: big, reason: 'size' },
      { file: bigWrong, reason: 'type' },
    ]);
  });

  it('supports image/* wildcard entries and is case-insensitive', () => {
    const webp = file('x.webp', 'image/webp');
    const jpeg = file('x.jpg', 'IMAGE/JPEG');
    const pdf = file('x.pdf', 'application/pdf');
    const { accepted, rejected } = validateUploadFiles([webp, jpeg, pdf], {
      accept: 'image/*',
      maxBytes: MB,
    });
    expect(accepted).toEqual([webp, jpeg]);
    expect(rejected).toEqual([{ file: pdf, reason: 'type' }]);
  });

  it('lets files without a reported MIME type through (server sniff decides)', () => {
    const unknown = file('IMG_0001.heic', '');
    expect(validateUploadFiles([unknown], { accept: IMAGE_ACCEPT, maxBytes: MB }).accepted).toEqual(
      [unknown],
    );
  });

  it('uploadRejectionMessage maps reasons to the common.upload keys', () => {
    const t = vi.fn((key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(',')}` : key,
    );
    expect(
      uploadRejectionMessage(t, { file: file('x.gif', 'image/gif'), reason: 'type' }, MB),
    ).toBe('rejectedType:x.gif');
    expect(
      uploadRejectionMessage(t, { file: file('big.png', 'image/png'), reason: 'size' }, 10 * MB),
    ).toBe('rejectedSize:big.png,10');
  });
});
