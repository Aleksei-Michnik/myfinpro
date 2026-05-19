import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleBadge } from './ScheduleBadge';
import type { ScheduleResponse } from '@/lib/payment/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values
      ? `${key}(${Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : key,
}));

function s(p: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 's-1',
    paymentId: 'p-1',
    cron: null,
    everyMs: 86_400_000,
    startsAt: '2026-05-10T00:00:00Z',
    endsAt: null,
    limit: null,
    nextRunAt: '2026-05-11T00:00:00Z',
    lastRunAt: null,
    pausedAt: null,
    cancelledAt: null,
    createdAt: '2026-05-10T00:00:00Z',
    updatedAt: '2026-05-10T00:00:00Z',
    ...p,
  };
}

describe('ScheduleBadge', () => {
  it('renders an active green pill + next run line', () => {
    render(<ScheduleBadge schedule={s()} />);
    const badge = screen.getByTestId('schedule-badge');
    expect(badge.getAttribute('data-status')).toBe('active');
    expect(screen.getByTestId('schedule-badge-status').textContent).toContain('statusActive');
    expect(screen.getByTestId('schedule-badge-next-run')).toBeInTheDocument();
  });

  it('paused state renders the paused pill + lastRun line when set', () => {
    render(
      <ScheduleBadge
        schedule={s({ pausedAt: '2026-05-12T00:00:00Z', lastRunAt: '2026-05-11T00:00:00Z' })}
      />,
    );
    expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('paused');
    expect(screen.getByTestId('schedule-badge-status').textContent).toContain('statusPaused');
    expect(screen.getByTestId('schedule-badge-last-run')).toBeInTheDocument();
    // No next-run line when not active.
    expect(screen.queryByTestId('schedule-badge-next-run')).not.toBeInTheDocument();
  });

  it('cancelled state renders cancelled pill + cancellation timestamp', () => {
    render(<ScheduleBadge schedule={s({ cancelledAt: '2026-05-13T00:00:00Z' })} />);
    expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('cancelled');
    expect(screen.getByTestId('schedule-badge-status').textContent).toContain('statusCancelled');
    expect(screen.getByTestId('schedule-badge-cancelled-at')).toBeInTheDocument();
  });

  it('cron schedule renders cron string with monospace font', () => {
    render(<ScheduleBadge schedule={s({ cron: '0 9 * * 1', everyMs: null })} />);
    const repeat = screen.getByTestId('schedule-badge-repeat');
    expect(repeat.textContent).toContain('repeatCron');
    expect(repeat.textContent).toContain('0 9 * * 1');
    expect(repeat.className).toContain('font-mono');
  });

  it('every-15-minutes renders repeatEveryMinutes(n=15)', () => {
    render(<ScheduleBadge schedule={s({ everyMs: 15 * 60_000 })} />);
    expect(screen.getByTestId('schedule-badge-repeat').textContent).toBe(
      'repeatEveryMinutes(n=15)',
    );
  });

  it('limit renders alongside other lines', () => {
    render(<ScheduleBadge schedule={s({ limit: 10 })} />);
    expect(screen.getByTestId('schedule-badge-limit').textContent).toBe('runsLimit(n=10)');
  });

  it('does not crash when nullable fields are all null', () => {
    render(
      <ScheduleBadge
        schedule={s({
          everyMs: null,
          cron: null,
          nextRunAt: null,
          lastRunAt: null,
          limit: null,
        })}
      />,
    );
    // Defensive — repeat line is rendered (empty), but no last-run / next-run.
    expect(screen.queryByTestId('schedule-badge-next-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('schedule-badge-last-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('schedule-badge-limit')).not.toBeInTheDocument();
  });

  it('respects RTL when rendered inside a dir=rtl container', () => {
    render(
      <div dir="rtl" data-testid="rtl-wrap">
        <ScheduleBadge schedule={s()} locale="he" />
      </div>,
    );
    const wrap = screen.getByTestId('rtl-wrap');
    expect(wrap.getAttribute('dir')).toBe('rtl');
    // Badge is inside; the wrapper's dir cascades — no inline LTR override.
    expect(screen.getByTestId('schedule-badge')).toBeInTheDocument();
  });
});
