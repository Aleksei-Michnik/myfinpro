// Phase 8.27 follow-up — body scroll lock behavior, including the nested
// case (two active locks release in any order without unfreezing early).

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBodyScrollLock } from './use-body-scroll-lock';

function Lock({ active = true }: { active?: boolean }) {
  useBodyScrollLock(active);
  return null;
}

describe('useBodyScrollLock', () => {
  it('locks body scroll while mounted and restores on unmount', () => {
    const { unmount } = render(<Lock />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('does nothing while inactive, locks once activated', () => {
    const { rerender } = render(<Lock active={false} />);
    expect(document.body.style.overflow).toBe('');
    rerender(<Lock active />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Lock active={false} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the lock until the last of nested locks releases', () => {
    const outer = render(<Lock />);
    const inner = render(<Lock />);
    inner.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    outer.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
