import { assertPublicReceiptUrl, UnsafeReceiptUrlError } from './receipt-url-guard.util';

describe('assertPublicReceiptUrl', () => {
  it('accepts ordinary public http(s) URLs', () => {
    expect(assertPublicReceiptUrl('https://receipts.example.com/r/abc').hostname).toBe(
      'receipts.example.com',
    );
    expect(assertPublicReceiptUrl('http://8.8.8.8/receipt').hostname).toBe('8.8.8.8');
    expect(assertPublicReceiptUrl('https://[2606:4700:4700::1111]/x').hostname).toContain('2606');
  });

  it.each([
    ['ftp://example.com/x', 'non-http scheme'],
    ['file:///etc/passwd', 'file scheme'],
    ['https://user:pass@example.com/x', 'embedded credentials'],
    ['http://localhost/x', 'localhost'],
    ['http://sub.localhost/x', '*.localhost'],
    ['http://db.internal/x', '.internal'],
    ['http://printer.local/x', '.local'],
    ['http://127.0.0.1/x', 'loopback v4'],
    ['http://0.0.0.0/x', 'this-host v4'],
    ['http://10.1.2.3/x', 'private 10/8'],
    ['http://172.16.5.5/x', 'private 172.16/12'],
    ['http://192.168.0.1/x', 'private 192.168/16'],
    ['http://169.254.169.254/latest/meta-data', 'cloud metadata'],
    ['http://100.100.5.5/x', 'CGNAT 100.64/10'],
    ['http://224.0.0.1/x', 'multicast'],
    ['http://[::1]/x', 'loopback v6'],
    ['http://[fd00::1]/x', 'unique-local v6'],
    ['http://[fe80::1]/x', 'link-local v6'],
    ['http://[::ffff:127.0.0.1]/x', 'v4-mapped loopback'],
  ])('rejects %s (%s)', (url) => {
    expect(() => assertPublicReceiptUrl(url)).toThrow(UnsafeReceiptUrlError);
  });

  it('allows public 172.x outside the private block', () => {
    expect(() => assertPublicReceiptUrl('http://172.32.0.1/x')).not.toThrow();
    expect(() => assertPublicReceiptUrl('http://172.15.0.1/x')).not.toThrow();
  });
});
