import type { ReceiptExtractionProgress } from '@myfinpro/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractionActivity } from './ExtractionActivity';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

type ProgressEvent = {
  type: 'receipt.extraction.progress';
  receiptId: string;
  progress: ReceiptExtractionProgress;
};
let capturedFilter: { type: string; receiptId?: string } | null = null;
let capturedHandler: ((event: ProgressEvent) => void) | null = null;
vi.mock('@/lib/realtime/use-realtime-events', () => ({
  useRealtimeEvents: (
    filter: { type: string; receiptId?: string },
    handler: (event: ProgressEvent) => void,
  ) => {
    capturedFilter = filter;
    capturedHandler = handler;
  },
}));

const push = (progress: ReceiptExtractionProgress) =>
  act(() => {
    capturedHandler?.({ type: 'receipt.extraction.progress', receiptId: 'r-1', progress });
  });

beforeEach(() => {
  capturedFilter = null;
  capturedHandler = null;
});
afterEach(() => vi.useRealTimers());

describe('ExtractionActivity (8.26)', () => {
  it('subscribes per receipt and rotates generic verbs while no event arrives', () => {
    vi.useFakeTimers();
    render(<ExtractionActivity receiptId="r-1" variant="panel" />);
    expect(capturedFilter).toEqual({ type: 'receipt.extraction.progress', receiptId: 'r-1' });
    expect(screen.getByTestId('extraction-stage-line')).toHaveTextContent('verbs.waiting.0');
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByTestId('extraction-stage-line')).toHaveTextContent('verbs.waiting.1');
  });

  it('resolves the sending line via the shared model catalog, with a generic fallback', () => {
    render(<ExtractionActivity receiptId="r-1" variant="panel" />);
    push({ stage: 'sending', provider: 'anthropic', model: 'claude-opus-4-8' });
    expect(screen.getByTestId('extraction-stage-line')).toHaveTextContent(
      'sendingTo:Anthropic Claude Opus 4.8',
    );
    push({ stage: 'sending', provider: 'anthropic', model: 'claude-unlisted' });
    expect(screen.getByTestId('extraction-stage-line')).toHaveTextContent(
      'sendingTo:claude-unlisted',
    );
    push({ stage: 'sending', provider: null, model: null });
    expect(screen.getByTestId('extraction-stage-line')).toHaveTextContent('sendingTo:genericModel');
  });

  it('shows the item counter while generating and the pass while continuing', () => {
    render(<ExtractionActivity receiptId="r-1" variant="panel" />);
    push({ stage: 'generating', provider: 'mock', model: null, itemsSoFar: 12 });
    expect(screen.getByTestId('extraction-stage-line')).toHaveTextContent('itemsSoFar:12');
    push({ stage: 'continuing', provider: 'mock', model: null, pass: 2 });
    expect(screen.getByTestId('extraction-stage-line')).toHaveTextContent('continuing:2');
  });

  it('tickers the latest thought and accumulates the full text behind the disclosure', () => {
    render(<ExtractionActivity receiptId="r-1" variant="panel" />);
    push({ stage: 'thinking', provider: 'mock', model: null, thought: 'Reading the header. ' });
    push({ stage: 'thinking', provider: 'mock', model: null, thought: 'Totals reconcile.' });
    // Ticker shows only the newest fragment.
    expect(screen.getByTestId('extraction-thought-ticker')).toHaveTextContent('Totals reconcile.');

    const toggle = screen.getByTestId('extraction-thoughts-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('extraction-thoughts-full')).toHaveTextContent(
      'Reading the header. Totals reconcile.',
    );
    // Collapsing hides the full text again (ephemeral, stays in state only).
    fireEvent.click(toggle);
    expect(screen.queryByTestId('extraction-thoughts-full')).not.toBeInTheDocument();
  });

  it('renders the compact inline variant without the thought disclosure', () => {
    render(<ExtractionActivity receiptId="r-1" variant="inline" />);
    push({ stage: 'thinking', provider: 'mock', model: null, thought: 'hmm' });
    expect(screen.getByTestId('extraction-activity-inline')).toHaveTextContent('verbs.thinking.0');
    expect(screen.queryByTestId('extraction-thoughts-toggle')).not.toBeInTheDocument();
  });

  it('keeps the pulse markup reduced-motion aware', () => {
    render(<ExtractionActivity receiptId="r-1" variant="panel" />);
    const activity = screen.getByTestId('extraction-activity');
    expect(activity.querySelector('.motion-reduce\\:hidden')).not.toBeNull();
    expect(activity.querySelector('.motion-reduce\\:animate-none')).not.toBeNull();
  });
});
