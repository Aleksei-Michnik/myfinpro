import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CopyField } from './CopyField';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Press Ctrl+C to copy',
    };
    return translations[key] ?? key;
  },
}));

describe('CopyField', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders a read-only, ltr, non-spellchecked field with the value', () => {
    render(<CopyField value="mfp_abc123" label="Token" testId="field" />);
    const input = screen.getByTestId('field') as HTMLInputElement;
    expect(input).toHaveValue('mfp_abc123');
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });

  it('selects the value on focus', () => {
    render(<CopyField value="mfp_abc123" label="Token" testId="field" />);
    const input = screen.getByTestId('field') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');
    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('copies via the clipboard and announces success', async () => {
    const onCopied = vi.fn();
    render(<CopyField value="mfp_abc123" label="Token" testId="field" onCopied={onCopied} />);

    fireEvent.click(screen.getByTestId('field-copy'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('mfp_abc123');
    await waitFor(() => expect(screen.getByTestId('field-status')).toHaveTextContent('Copied'));
    expect(onCopied).toHaveBeenCalled();
  });

  it('falls back to selecting the field and announces the fallback hint when the clipboard fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<CopyField value="mfp_abc123" label="Token" testId="field" />);

    fireEvent.click(screen.getByTestId('field-copy'));

    await waitFor(() =>
      expect(screen.getByTestId('field-status')).toHaveTextContent('Press Ctrl+C to copy'),
    );
  });

  it('renders a textarea for multiline values and copies every line', () => {
    const value = 'line one\nline two';
    render(<CopyField value={value} label="Commands" multiline testId="commands" />);

    const field = screen.getByTestId('commands') as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveValue(value);

    fireEvent.click(screen.getByTestId('commands-copy'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(value);
  });

  it('lets a caller override the copy/copied/failed wording and testids', async () => {
    render(
      <CopyField
        value="mfp_abc123"
        testId="token-reveal-value"
        copyTestId="token-reveal-copy"
        statusTestId="token-reveal-status"
        copyLabel="Copy token"
        copiedLabel="Token copied"
        ariaLabel="Token"
      />,
    );

    expect(screen.getByTestId('token-reveal-copy')).toHaveTextContent('Copy token');
    fireEvent.click(screen.getByTestId('token-reveal-copy'));
    await waitFor(() =>
      expect(screen.getByTestId('token-reveal-status')).toHaveTextContent('Token copied'),
    );
  });

  it('focuses and selects on mount when autoFocus is set', () => {
    render(<CopyField value="mfp_abc123" ariaLabel="Token" testId="field" autoFocus />);
    const input = screen.getByTestId('field') as HTMLInputElement;
    expect(input).toHaveFocus();
  });
});
