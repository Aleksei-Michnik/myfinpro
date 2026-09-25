import { describe, expect, it, vi } from 'vitest';
import { APPLY_SUGGESTIONS_MAX_ROUNDS, drainSuggestions } from '../apply-suggestions';

const round = (applied: number, remaining: number) => ({
  matched: applied,
  created: 0,
  transferred: 0,
  skipped: 0,
  remaining,
});

describe('drainSuggestions', () => {
  it('keeps calling while the queue shrinks and stops when it is drained', async () => {
    const apply = vi
      .fn()
      .mockResolvedValueOnce(round(200, 150))
      .mockResolvedValueOnce(round(150, 0));
    const totals = await drainSuggestions(apply);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(totals.matched).toBe(350);
  });

  it('stops on a round that applies nothing', async () => {
    const apply = vi.fn().mockResolvedValue(round(0, 7));
    await drainSuggestions(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('stops when remaining does not decrease, even if something was applied', async () => {
    const apply = vi.fn().mockResolvedValue(round(3, 7));
    await drainSuggestions(apply);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('never exceeds the round ceiling', async () => {
    let remaining = 100_000;
    const apply = vi.fn().mockImplementation(async () => round(1, (remaining -= 1)));
    await drainSuggestions(apply);
    expect(apply).toHaveBeenCalledTimes(APPLY_SUGGESTIONS_MAX_ROUNDS);
  });
});
