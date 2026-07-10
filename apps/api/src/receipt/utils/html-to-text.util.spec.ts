import { htmlToReceiptText, RECEIPT_TEXT_MAX_CHARS } from './html-to-text.util';

describe('htmlToReceiptText', () => {
  it('strips scripts, styles, head, and comments while keeping visible text', () => {
    const html = `
      <html>
        <head><title>Order #123</title><style>.x{color:red}</style></head>
        <body>
          <!-- tracking pixel -->
          <script>window.dataLayer = [];</script>
          <noscript>Enable JS</noscript>
          <h1>Shufersal Deal</h1>
          <p>Total: 45.90</p>
        </body>
      </html>`;
    const text = htmlToReceiptText(html);
    expect(text).toContain('Shufersal Deal');
    expect(text).toContain('Total: 45.90');
    expect(text).not.toContain('dataLayer');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('Order #123'); // head is invisible
    expect(text).not.toContain('Enable JS');
    expect(text).not.toContain('tracking pixel');
  });

  it('keeps line items on their own lines and separates table cells', () => {
    const html =
      '<table>' +
      '<tr><td>Milk 3%</td><td>2</td><td>10.00</td></tr>' +
      '<tr><td>Bread</td><td>1</td><td>25.90</td></tr>' +
      '</table>';
    const text = htmlToReceiptText(html);
    const lines = text.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/Milk 3%\t2\t10\.00/);
    expect(lines[1]).toMatch(/Bread\t1\t25\.90/);
  });

  it('decodes numeric and named entities (incl. Hebrew + shekel)', () => {
    const text = htmlToReceiptText(
      '<p>&#1495;&#1500;&#1489; &amp; &quot;Bread&quot; &#x20aa;9.90&nbsp;</p>',
    );
    expect(text).toBe('חלב & "Bread" ₪9.90');
  });

  it('collapses whitespace noise and blank-line runs', () => {
    const text = htmlToReceiptText('<div>a</div>\n\n\n\n<div>   b    c</div>');
    expect(text).toBe('a\n\nb\tc');
  });

  it('passes plain text through apart from collapsing and the cap', () => {
    expect(htmlToReceiptText('Total 12.50 ILS')).toBe('Total 12.50 ILS');
  });

  it('caps the output length', () => {
    const text = htmlToReceiptText(`<p>${'x'.repeat(RECEIPT_TEXT_MAX_CHARS + 5_000)}</p>`);
    expect(text.length).toBe(RECEIPT_TEXT_MAX_CHARS);
    expect(htmlToReceiptText('<p>abcdef</p>', 3)).toBe('abc');
  });

  it('leaves unknown named entities untouched instead of corrupting them', () => {
    expect(htmlToReceiptText('a &unknownthing; b')).toBe('a &unknownthing; b');
  });
});
