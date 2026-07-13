import { PairzonProvider, pairzonJsonToReceiptText } from './pairzon.provider';
import type { SafeFetchResult } from './receipt-url-provider.interface';

/** A representative slice of a real Pairzon document (noise fields included). */
const DOC = {
  total: 35.9,
  totalNoVat: 30.0,
  totalVat: 5.9,
  createdDate: '2026-07-08T21:03:41',
  store: {
    name: 'נהריה',
    address: 'לוחמי הגטאות 9',
    business: { name: 'קשת טעמים', currency: 'ILS', englishName: 'Keshet' },
  },
  // Noise that must NOT reach the model:
  loyaltyName: 'Some Customer',
  notes: 'card XXXXXXXX2887 · voucher 17002089',
  hasdedIdentifier: 'deadbeefhash',
  items: [
    { name: 'Milk 3%', code: '7290000', quantity: 2, price: 5.9, total: 11.8, category: ['Dairy'] },
    {
      name: 'Bread',
      code: '7290111',
      quantity: 1,
      price: 12.0,
      total: 12.0,
      additionalInfo: [{ key: 'promo פירורים', value: '-2.00' }],
    },
  ],
};
const DOC_JSON = JSON.stringify(DOC);

describe('PairzonProvider', () => {
  const provider = new PairzonProvider();

  const fetched = (
    finalUrl: string,
    body: string,
    contentType = 'application/json',
  ): SafeFetchResult => ({
    finalUrl: new URL(finalUrl),
    contentType,
    body: Buffer.from(body, 'utf8'),
  });

  describe('matches', () => {
    it('accepts pairzon.com and its subdomains only', () => {
      expect(provider.matches(new URL('https://pairzon.com/x'))).toBe(true);
      expect(provider.matches(new URL('https://public.pairzon.com/x'))).toBe(true);
      expect(provider.matches(new URL('https://a.b.pairzon.com/x'))).toBe(true);
    });
    it('rejects look-alike hosts', () => {
      expect(provider.matches(new URL('https://evilpairzon.com/x'))).toBe(false);
      expect(provider.matches(new URL('https://pairzon.com.evil.com/x'))).toBe(false);
      expect(provider.matches(new URL('https://example.com/x'))).toBe(false);
    });
  });

  describe('resolveContent', () => {
    it('reads the JSON endpoint directly when the URL already carries id + p', async () => {
      const fetchSafe = jest
        .fn()
        .mockResolvedValue(
          fetched('https://public.pairzon.com/v1.0/documents/DOC123?p=1331', DOC_JSON),
        );

      const text = await provider.resolveContent(
        new URL('https://public.pairzon.com/0351.html?id=DOC123&p=1331'),
        fetchSafe,
      );

      // Ids were in the query — a single fetch, straight to the data endpoint.
      expect(fetchSafe).toHaveBeenCalledTimes(1);
      expect(fetchSafe).toHaveBeenCalledWith(
        'https://public.pairzon.com/v1.0/documents/DOC123?p=1331',
      );
      expect(text).toContain('Merchant: קשת טעמים');
      expect(text).toContain('barcode 7290000');
    });

    it('follows the short-link redirect to discover id + p, then reads the data', async () => {
      const fetchSafe = jest
        .fn()
        .mockResolvedValueOnce(
          fetched('https://public.pairzon.com/0351.html?id=DOC9&p=1331', '', 'text/html'),
        )
        .mockResolvedValueOnce(
          fetched('https://public.pairzon.com/v1.0/documents/DOC9?p=1331', DOC_JSON),
        );

      const text = await provider.resolveContent(
        new URL('https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05'),
        fetchSafe,
      );

      expect(fetchSafe).toHaveBeenNthCalledWith(
        1,
        'https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05',
      );
      expect(fetchSafe).toHaveBeenNthCalledWith(
        2,
        'https://public.pairzon.com/v1.0/documents/DOC9?p=1331',
      );
      expect(text).toContain('Merchant: קשת טעמים');
    });

    it('defers to the generic path (null) when the ids never surface', async () => {
      const fetchSafe = jest
        .fn()
        .mockResolvedValue(fetched('https://public.pairzon.com/0351.html', '', 'text/html'));

      const text = await provider.resolveContent(
        new URL('https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05'),
        fetchSafe,
      );
      expect(text).toBeNull();
      expect(fetchSafe).toHaveBeenCalledTimes(1); // discovery only — no data fetch
    });

    it('defers to the generic path (null) when the data endpoint is not JSON', async () => {
      const fetchSafe = jest
        .fn()
        .mockResolvedValue(
          fetched(
            'https://public.pairzon.com/v1.0/documents/DOC123?p=1331',
            '<html>nope</html>',
            'text/html',
          ),
        );

      const text = await provider.resolveContent(
        new URL('https://public.pairzon.com/0351.html?id=DOC123&p=1331'),
        fetchSafe,
      );
      expect(text).toBeNull();
    });

    it('url-encodes the document id into the path', async () => {
      const fetchSafe = jest
        .fn()
        .mockResolvedValue(
          fetched('https://public.pairzon.com/v1.0/documents/a%2Fb?p=1331', DOC_JSON),
        );
      await provider.resolveContent(
        new URL('https://public.pairzon.com/0351.html?id=a%2Fb&p=1331'),
        fetchSafe,
      );
      expect(fetchSafe).toHaveBeenCalledWith(
        'https://public.pairzon.com/v1.0/documents/a%2Fb?p=1331',
      );
    });
  });
});

describe('pairzonJsonToReceiptText', () => {
  it('reduces a document to compact receipt text with per-line detail', () => {
    const text = pairzonJsonToReceiptText(DOC_JSON)!;
    expect(text).toContain('Merchant: קשת טעמים (branch: נהריה)');
    expect(text).toContain('Currency: ILS');
    expect(text).toContain('Total: 35.90 (excl. VAT 30.00, VAT 5.90)');
    expect(text).toContain('Items: 2');
    expect(text).toContain('1. Milk 3% | barcode 7290000 | qty 2 | unit 5.90 | line 11.80');
    expect(text).toContain(
      '2. Bread | barcode 7290111 | qty 1 | unit 12.00 | line 12.00 | discount -2.00 (promo פירורים)',
    );
  });

  it('drops customer, payment and hash noise', () => {
    const text = pairzonJsonToReceiptText(DOC_JSON)!;
    expect(text).not.toContain('Some Customer'); // loyaltyName (the shopper)
    expect(text).not.toContain('2887'); // masked card from notes
    expect(text).not.toContain('deadbeefhash');
  });

  it('returns a header even when there are no items', () => {
    const text = pairzonJsonToReceiptText(
      JSON.stringify({
        total: 10,
        store: { business: { name: 'Shop', currency: 'ILS' } },
        items: [],
      }),
    )!;
    expect(text).toContain('Merchant: Shop');
    expect(text).toContain('Items: 0');
  });

  it('returns null for a non-JSON body', () => {
    expect(pairzonJsonToReceiptText('<html>not json</html>')).toBeNull();
  });
});
