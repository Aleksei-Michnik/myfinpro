import { PairzonProvider } from './pairzon.provider';
import type { SafeFetchResult } from './receipt-url-provider.interface';

describe('PairzonProvider', () => {
  const provider = new PairzonProvider();

  const landing = (finalUrl: string): SafeFetchResult => ({
    finalUrl: new URL(finalUrl),
    contentType: 'text/html',
    body: Buffer.from('<html><body>Loading...</body></html>'),
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

  describe('resolveDataUrl', () => {
    it('builds the JSON endpoint directly when the URL already carries id + p', async () => {
      const fetchSafe = jest.fn();
      const resolved = await provider.resolveDataUrl(
        new URL('https://public.pairzon.com/0351.html?id=DOC123&p=1331'),
        fetchSafe,
      );
      expect(resolved).toEqual({
        dataUrl: 'https://public.pairzon.com/v1.0/documents/DOC123?p=1331',
        kind: 'json',
      });
      // Ids were in the query — no need to spend a redirect fetch.
      expect(fetchSafe).not.toHaveBeenCalled();
    });

    it('follows the short-link redirect to discover id + p', async () => {
      const fetchSafe = jest
        .fn()
        .mockResolvedValue(landing('https://public.pairzon.com/0351.html?id=DOC9&p=1331'));

      const resolved = await provider.resolveDataUrl(
        new URL('https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05'),
        fetchSafe,
      );

      expect(fetchSafe).toHaveBeenCalledWith(
        'https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05',
      );
      expect(resolved).toEqual({
        dataUrl: 'https://public.pairzon.com/v1.0/documents/DOC9?p=1331',
        kind: 'json',
      });
    });

    it('defers to the generic path (null) when the ids never surface', async () => {
      const fetchSafe = jest
        .fn()
        .mockResolvedValue(landing('https://public.pairzon.com/0351.html'));

      const resolved = await provider.resolveDataUrl(
        new URL('https://public.pairzon.com/1331/3s70TWnbWeywEHEs5MPR05'),
        fetchSafe,
      );
      expect(resolved).toBeNull();
    });

    it('url-encodes the document id into the path', async () => {
      const resolved = await provider.resolveDataUrl(
        new URL('https://public.pairzon.com/0351.html?id=a%2Fb&p=1331'),
        jest.fn(),
      );
      expect(resolved?.dataUrl).toBe('https://public.pairzon.com/v1.0/documents/a%2Fb?p=1331');
    });
  });
});
