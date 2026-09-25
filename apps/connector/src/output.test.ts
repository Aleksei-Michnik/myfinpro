import { describe, expect, it } from 'vitest';
import { maskForLog } from './output.js';

describe('maskForLog', () => {
  it('keeps a short description and cuts a long one', () => {
    expect(maskForLog('CAFE')).toBe('CAFE');
    expect(maskForLog('  SHUFERSAL DEAL TEL AVIV ')).toBe('SHUFER…');
  });
});
