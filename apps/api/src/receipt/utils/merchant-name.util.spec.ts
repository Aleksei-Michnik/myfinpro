import { normalizeMerchantName } from './merchant-name.util';

describe('normalizeMerchantName', () => {
  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeMerchantName('  Shufersal   DEAL  ')).toBe('shufersal deal');
  });

  it('strips diacritics while keeping base letters', () => {
    expect(normalizeMerchantName('Café Über')).toBe('cafe uber');
  });

  it('keeps Hebrew intact', () => {
    expect(normalizeMerchantName('שופרסל דיל')).toBe('שופרסל דיל');
  });

  it('caps at 200 chars', () => {
    expect(normalizeMerchantName('x'.repeat(300))).toHaveLength(200);
  });
});
