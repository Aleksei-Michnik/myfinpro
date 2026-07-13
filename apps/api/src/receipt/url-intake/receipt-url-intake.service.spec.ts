import { RECEIPT_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import { ExtractionFailedError } from '../extraction/extraction-provider.interface';
import { PairzonProvider } from './pairzon.provider';
import { maskPath, ReceiptUrlIntakeService } from './receipt-url-intake.service';
import type { ReceiptUrlProvider } from './receipt-url-provider.interface';

describe('ReceiptUrlIntakeService', () => {
  const prismaMock = {
    receiptUrlIntake: { count: jest.fn(), create: jest.fn() },
  };

  const makeService = (providers: ReceiptUrlProvider[] = []) =>
    new ReceiptUrlIntakeService(prismaMock as never, providers);

  /** A 2xx fetch Response carrying `body` with the given content-type. */
  const ok = (body: string | Buffer, contentType: string) => {
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': contentType }),
      arrayBuffer: () =>
        Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    } as unknown as Response;
  };
  /** A non-2xx Response (redirects carry a Location; errors just carry status). */
  const status = (code: number, headers: Record<string, string> = {}) =>
    ({
      ok: false,
      status: code,
      headers: new Headers(headers),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }) as unknown as Response;

  const spyFetch = () => jest.spyOn(global, 'fetch');

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.receiptUrlIntake.count.mockResolvedValue(0);
    prismaMock.receiptUrlIntake.create.mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  const lastIntake = () => {
    const calls = prismaMock.receiptUrlIntake.create.mock.calls;
    return calls[calls.length - 1]?.[0]?.data;
  };

  // ── Generic path (no provider matches) ────────────────────────────────────

  it('reduces an HTML page to readable text and records a plain fetch', async () => {
    spyFetch().mockResolvedValue(
      ok(
        '<html><head><script>track()</script></head><body><p>Shufersal receipt 45.90</p></body></html>',
        'text/html; charset=utf-8',
      ),
    );

    const input = await makeService().resolve('https://r.example/x');

    expect(input).toEqual({
      kind: 'html',
      data: 'Shufersal receipt 45.90',
      sourceUrl: 'https://r.example/x',
    });
    expect(lastIntake()).toEqual({
      host: 'r.example',
      pathTemplate: '/x',
      provider: null,
      outcome: 'fetched',
    });
  });

  it('routes a URL serving a PDF to the native document input (magic bytes win)', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0x00, 0x01, 0x02])]);
    // Deliberately vague content-type — the magic bytes must decide.
    spyFetch().mockResolvedValue(ok(pdf, 'application/octet-stream'));

    const input = await makeService().resolve('https://r.example/doc');

    expect(input.kind).toBe('pdf');
    expect(input.kind === 'pdf' && input.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(lastIntake().outcome).toBe('binary_pdf');
  });

  it('routes a URL serving an image (even mislabelled as HTML) to the vision input', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    spyFetch().mockResolvedValue(ok(png, 'text/html'));

    const input = await makeService().resolve('https://r.example/pic');

    expect(input).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(lastIntake().outcome).toBe('binary_image');
  });

  it('fails permanently on unsupported binary content, recording the outcome', async () => {
    // Unknown binary (NUL bytes, no recognised magic) — never mojibake at the
    // model, always a clear failure.
    spyFetch().mockResolvedValue(ok(Buffer.from('BLOB\0\0\0garbage'), 'application/octet-stream'));

    await expect(makeService().resolve('https://r.example/blob')).rejects.toThrow(
      /unsupported file type/,
    );
    expect(lastIntake().outcome).toBe('binary_unsupported');
  });

  it('fails permanently when the content exceeds the size cap', async () => {
    spyFetch().mockResolvedValue(
      ok(Buffer.alloc(RECEIPT_MAX_FILE_SIZE_BYTES + 1), 'application/pdf'),
    );
    await expect(makeService().resolve('https://r.example/big')).rejects.toBeInstanceOf(
      ExtractionFailedError,
    );
    await expect(makeService().resolve('https://r.example/big')).rejects.toThrow(/limit/);
  });

  it('treats a 4xx as permanent and a 5xx as transient (BullMQ retries the latter)', async () => {
    const fetchSpy = spyFetch().mockResolvedValue(status(404));
    await expect(makeService().resolve('https://r.example/gone')).rejects.toBeInstanceOf(
      ExtractionFailedError,
    );

    fetchSpy.mockResolvedValue(status(503));
    const err = await makeService()
      .resolve('https://r.example/down')
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ExtractionFailedError); // transient → not swallowed
  });

  it('keeps receipt lines that sit past a huge inline script blob', async () => {
    // 600 KB of inline script BEFORE the items — a raw-HTML cap would have cut
    // the receipt content off; reduce-then-cap keeps it.
    const html = `<html><body><script>${'x'.repeat(600_000)}</script><p>Total 45.90</p></body></html>`;
    spyFetch().mockResolvedValue(ok(html, 'text/html'));

    const input = await makeService().resolve('https://r.example/long');
    expect(input.kind === 'html' && input.data).toContain('Total 45.90');
  });

  it('follows redirects and re-checks each hop against the SSRF guard', async () => {
    const fetchSpy = spyFetch().mockImplementation((req) => {
      const u = String(req);
      if (u === 'https://r.example/start')
        return Promise.resolve(status(302, { location: 'https://r.example/final' }));
      return Promise.resolve(ok('<p>Total 12.00</p>', 'text/html'));
    });

    const input = await makeService().resolve('https://r.example/start');
    expect(input.kind === 'html' && input.data).toContain('Total 12.00');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect that lands on an internal address', async () => {
    const fetchSpy = spyFetch().mockResolvedValue(
      status(302, { location: 'http://169.254.169.254/latest/meta-data' }),
    );
    await expect(makeService().resolve('https://r.example/evil')).rejects.toBeInstanceOf(
      ExtractionFailedError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1); // stopped before fetching the metadata IP
  });

  // ── SSRF guard at ingestion ───────────────────────────────────────────────

  it('rejects a loopback URL before any fetch', async () => {
    const fetchSpy = spyFetch();
    await expect(makeService().resolve('http://localhost/receipt')).rejects.toBeInstanceOf(
      ExtractionFailedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Per-host egress politeness ────────────────────────────────────────────

  it('backs off (transiently) and records a throttle when a host is hit too often', async () => {
    prismaMock.receiptUrlIntake.count.mockResolvedValue(30);
    const fetchSpy = spyFetch();

    const err = await makeService()
      .resolve('https://busy.example/r/token123456')
      .catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ExtractionFailedError); // transient → retried, not failed
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lastIntake()).toMatchObject({ host: 'busy.example', outcome: 'throttled' });
  });

  // ── Anonymized logging ────────────────────────────────────────────────────

  it('logs the path SHAPE, never the live bearer token', async () => {
    spyFetch().mockResolvedValue(ok('<p>x</p>', 'text/html'));

    await makeService().resolve('https://r.example/receipt/3s70TWnbWeywEHEs5MPR05');

    expect(lastIntake().pathTemplate).toBe('/receipt/:token');
    expect(lastIntake().pathTemplate).not.toContain('3s70TWnbWeywEHEs5MPR05');
  });

  // ── Provider dispatch (Pairzon) ───────────────────────────────────────────

  it('dispatches a Pairzon link with ids in the query straight to its JSON endpoint', async () => {
    const fetchSpy = spyFetch().mockResolvedValue(
      ok('{"merchant":"Rami Levy","total":59395}', 'application/json'),
    );

    const input = await makeService([new PairzonProvider()]).resolve(
      'https://public.pairzon.com/0351.html?id=DOC123&p=1331',
    );

    // Fetched the data endpoint (not the HTML shell), raw JSON handed through.
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      'https://public.pairzon.com/v1.0/documents/DOC123?p=1331',
    );
    expect(input).toMatchObject({ kind: 'html' });
    expect(input.kind === 'html' && input.data).toContain('Rami Levy');
    expect(lastIntake()).toMatchObject({
      host: 'public.pairzon.com',
      provider: 'pairzon',
      outcome: 'provider_ok',
    });
  });

  it('resolves a Pairzon short link by following its redirect to learn the ids (the reported case)', async () => {
    const fetchSpy = spyFetch().mockImplementation((req) => {
      const u = String(req);
      // 1) short link 302s to the canonical shell carrying id + p
      if (u === 'https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05')
        return Promise.resolve(
          status(302, { location: 'https://public.pairzon.com/0351.html?id=DOC9&p=1331' }),
        );
      // 2) the shell itself is an empty client-rendered page
      if (u.startsWith('https://public.pairzon.com/0351.html'))
        return Promise.resolve(ok('<html><body>Loading...</body></html>', 'text/html'));
      // 3) the JSON data endpoint the browser would have called
      if (u.startsWith('https://public.pairzon.com/v1.0/documents/DOC9'))
        return Promise.resolve(ok('{"merchant":"Keshet Teamim","total":8830}', 'application/json'));
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });

    const input = await makeService([new PairzonProvider()]).resolve(
      'https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05',
    );

    expect(input.kind === 'html' && input.data).toContain('Keshet Teamim');
    expect(String(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0])).toBe(
      'https://public.pairzon.com/v1.0/documents/DOC9?p=1331',
    );
    expect(lastIntake()).toMatchObject({ provider: 'pairzon', outcome: 'provider_ok' });
  });
});

describe('maskPath', () => {
  it('masks id/token-shaped segments and keeps wordy ones', () => {
    expect(maskPath('/1331/3s70TWnbWeywEHEs5MPR05')).toBe('/:token/:token');
    expect(maskPath('/receipt')).toBe('/receipt');
    expect(maskPath('/orders/view')).toBe('/orders/view');
    expect(maskPath('/u/AbCdEfGhIjK')).toBe('/u/:token');
    expect(maskPath('/invoice/2026/000123.pdf')).toBe('/invoice/:token/:token');
    expect(maskPath('/')).toBe('/');
    expect(maskPath('')).toBe('/');
  });
});
