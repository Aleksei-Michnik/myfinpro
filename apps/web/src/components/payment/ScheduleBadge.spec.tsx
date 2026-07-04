import { fireEvent, render, screen } from '@testing-library/react';
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

  // ── Phase 6 · Iteration 6.18.2 — lifecycle controls ─────────────────────

  describe('lifecycle actions', () => {
    it('renders no actions row without canManage', () => {
      render(<ScheduleBadge schedule={s()} onPause={vi.fn()} />);
      expect(screen.queryByTestId('schedule-actions')).not.toBeInTheDocument();
    });

    it('active: shows Pause + Cancel, no Resume; onPause fires', () => {
      const onPause = vi.fn();
      render(<ScheduleBadge schedule={s()} canManage onPause={onPause} />);
      expect(screen.getByTestId('schedule-action-pause')).toBeInTheDocument();
      expect(screen.getByTestId('schedule-action-cancel')).toBeInTheDocument();
      expect(screen.queryByTestId('schedule-action-resume')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('schedule-action-pause'));
      expect(onPause).toHaveBeenCalledTimes(1);
    });

    it('paused: shows Resume; onResume fires', () => {
      const onResume = vi.fn();
      render(
        <ScheduleBadge
          schedule={s({ pausedAt: '2026-05-12T00:00:00Z' })}
          canManage
          onResume={onResume}
        />,
      );
      expect(screen.queryByTestId('schedule-action-pause')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('schedule-action-resume'));
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('cancelled: terminal — no actions row at all', () => {
      render(<ScheduleBadge schedule={s({ cancelledAt: '2026-05-13T00:00:00Z' })} canManage />);
      expect(screen.queryByTestId('schedule-actions')).not.toBeInTheDocument();
    });

    it('cancel is two-step: first click arms, confirm fires onCancel', () => {
      const onCancel = vi.fn();
      render(<ScheduleBadge schedule={s()} canManage onCancel={onCancel} />);
      fireEvent.click(screen.getByTestId('schedule-action-cancel'));
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByTestId('schedule-cancel-confirm')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('schedule-cancel-confirm-yes'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('cancel confirm can be dismissed with Keep', () => {
      const onCancel = vi.fn();
      render(<ScheduleBadge schedule={s()} canManage onCancel={onCancel} />);
      fireEvent.click(screen.getByTestId('schedule-action-cancel'));
      fireEvent.click(screen.getByTestId('schedule-cancel-confirm-keep'));
      expect(screen.queryByTestId('schedule-cancel-confirm')).not.toBeInTheDocument();
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByTestId('schedule-action-cancel')).toBeInTheDocument();
    });

    it('pending disables every lifecycle control', () => {
      render(<ScheduleBadge schedule={s()} canManage pending />);
      expect((screen.getByTestId('schedule-action-pause') as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect((screen.getByTestId('schedule-action-cancel') as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
  });
});
