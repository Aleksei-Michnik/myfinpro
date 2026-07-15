import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  TransactionScheduleSubForm,
  buildScheduleSpec,
  defaultScheduleSubFormState,
  scheduleResponseToFormState,
  type ScheduleSubFormErrors,
  type ScheduleSubFormState,
} from './TransactionScheduleSubForm';
import type { ScheduleResponse } from '@/lib/transaction/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

/** Identity-key formatter for the validator helper. */
const tValidation = (key: string): string => key;

function controlled(initial?: Partial<ScheduleSubFormState>) {
  const start: ScheduleSubFormState = { ...defaultScheduleSubFormState(), ...initial };
  const onChange = vi.fn();
  let state = start;
  const Wrapper = ({
    errors = {},
    disabled,
  }: {
    errors?: ScheduleSubFormErrors;
    disabled?: boolean;
  }) => {
    return (
      <TransactionScheduleSubForm
        state={state}
        errors={errors}
        onChange={(next) => {
          state = next;
          onChange(next);
        }}
        disabled={disabled}
      />
    );
  };
  return {
    Wrapper,
    onChange,
    getState: () => state,
  };
}

describe('TransactionScheduleSubForm — render', () => {
  it('renders the every/cron radio group with every preselected by default', () => {
    const { Wrapper } = controlled();
    render(<Wrapper />);
    const every = screen.getByTestId('schedule-mode-every') as HTMLInputElement;
    const cron = screen.getByTestId('schedule-mode-cron') as HTMLInputElement;
    expect(every.checked).toBe(true);
    expect(cron.checked).toBe(false);
    expect(screen.getByTestId('schedule-every-path')).toBeInTheDocument();
    expect(screen.queryByTestId('schedule-cron-path')).not.toBeInTheDocument();
  });

  it('switching to cron hides the every path and shows cron input', () => {
    const { Wrapper, onChange } = controlled();
    const { rerender } = render(<Wrapper />);
    fireEvent.click(screen.getByTestId('schedule-mode-cron'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'cron' }));
    rerender(<Wrapper />);
    expect(screen.queryByTestId('schedule-every-path')).not.toBeInTheDocument();
    expect(screen.getByTestId('schedule-cron-path')).toBeInTheDocument();
  });

  it('disabled=true disables every input', () => {
    const { Wrapper } = controlled();
    render(<Wrapper disabled />);
    expect((screen.getByTestId('schedule-mode-every') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('schedule-mode-cron') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('schedule-every-count') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('schedule-every-unit') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByTestId('schedule-starts-at') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('schedule-ends-at') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('schedule-limit') as HTMLInputElement).disabled).toBe(true);
  });

  it('inline error messages render with role=alert when errors are passed', () => {
    const { Wrapper } = controlled();
    render(
      <Wrapper
        errors={{ every: 'too small', startsAt: 'bad', limit: 'too low', spec: 'pick one' }}
      />,
    );
    expect(screen.getByTestId('schedule-error-every')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('schedule-error-starts-at')).toHaveTextContent('bad');
    expect(screen.getByTestId('schedule-error-limit')).toHaveTextContent('too low');
    expect(screen.getByTestId('schedule-error-spec')).toHaveTextContent('pick one');
  });

  it('typing in cron mode updates state', () => {
    const { Wrapper, onChange } = controlled({ mode: 'cron' });
    render(<Wrapper />);
    fireEvent.change(screen.getByTestId('schedule-cron-input'), {
      target: { value: '*/5 * * * *' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cron: '*/5 * * * *' }));
  });
});

describe('buildScheduleSpec — validation', () => {
  it('rejects everyMs < 60_000 (every mode, sub-minute)', () => {
    const state = {
      ...defaultScheduleSubFormState(),
      everyCountStr: '0',
      everyUnit: 'minute' as const,
    };
    const out = buildScheduleSpec(state, tValidation);
    expect(out.ok).toBe(false);
    expect(out.errors.every).toBeDefined();
  });

  it('rejects empty cron in cron mode', () => {
    const state: ScheduleSubFormState = {
      ...defaultScheduleSubFormState(),
      mode: 'cron',
      cron: '',
    };
    const out = buildScheduleSpec(state, tValidation);
    expect(out.ok).toBe(false);
    expect(out.errors.cron).toBeDefined();
  });

  it('rejects endsAt earlier than startsAt', () => {
    const state: ScheduleSubFormState = {
      ...defaultScheduleSubFormState(),
      startsAt: '2026-05-10',
      endsAt: '2026-05-01',
    };
    const out = buildScheduleSpec(state, tValidation);
    expect(out.ok).toBe(false);
    expect(out.errors.endsAt).toBeDefined();
  });

  it('rejects limit < 1', () => {
    const state: ScheduleSubFormState = { ...defaultScheduleSubFormState(), limitStr: '0' };
    const out = buildScheduleSpec(state, tValidation);
    expect(out.ok).toBe(false);
    expect(out.errors.limit).toBeDefined();
  });

  it('happy path every-1-day produces everyMs=86_400_000 and ISO startsAt', () => {
    const state: ScheduleSubFormState = {
      ...defaultScheduleSubFormState(),
      startsAt: '2026-05-10',
    };
    const out = buildScheduleSpec(state, tValidation);
    expect(out.ok).toBe(true);
    expect(out.spec.everyMs).toBe(86_400_000);
    expect(out.spec.startsAt).toBe('2026-05-10T00:00:00Z');
    expect(out.spec.cron).toBeUndefined();
  });

  it('happy path cron mode forwards the raw expression', () => {
    const state: ScheduleSubFormState = {
      ...defaultScheduleSubFormState(),
      mode: 'cron',
      cron: '0 9 * * 1',
    };
    const out = buildScheduleSpec(state, tValidation);
    expect(out.ok).toBe(true);
    expect(out.spec.cron).toBe('0 9 * * 1');
    expect(out.spec.everyMs).toBeUndefined();
  });

  it('limit and endsAt populate the spec when valid', () => {
    const state: ScheduleSubFormState = {
      ...defaultScheduleSubFormState(),
      startsAt: '2026-05-10',
      endsAt: '2026-12-31',
      limitStr: '12',
    };
    const out = buildScheduleSpec(state, tValidation);
    expect(out.ok).toBe(true);
    expect(out.spec.endsAt).toBe('2026-12-31T00:00:00Z');
    expect(out.spec.limit).toBe(12);
  });
});

describe('scheduleResponseToFormState — edit-flow pre-fill', () => {
  function r(p: Partial<ScheduleResponse> = {}): ScheduleResponse {
    return {
      id: 's-1',
      transactionId: 'p-1',
      cron: null,
      everyMs: null,
      startsAt: '2026-05-10T00:00:00Z',
      endsAt: null,
      limit: null,
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      cancelledAt: null,
      createdAt: '2026-05-10T00:00:00Z',
      updatedAt: '2026-05-10T00:00:00Z',
      ...p,
    };
  }

  it('decodes everyMs=86_400_000 → every / 1 / day', () => {
    const out = scheduleResponseToFormState(r({ everyMs: 86_400_000 }));
    expect(out).toMatchObject({ mode: 'every', everyCountStr: '1', everyUnit: 'day' });
  });

  it('decodes cron + limit + endsAt', () => {
    const out = scheduleResponseToFormState(
      r({ cron: '0 9 * * 1', limit: 5, endsAt: '2026-12-31T00:00:00Z' }),
    );
    expect(out).toMatchObject({
      mode: 'cron',
      cron: '0 9 * * 1',
      limitStr: '5',
      endsAt: '2026-12-31',
    });
  });
});
