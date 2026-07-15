import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeScannerDialog } from './BarcodeScannerDialog';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// jsdom has no camera; getUserMedia rejection must degrade to manual entry.

function renderDialog() {
  const onClose = vi.fn();
  const onDetected = vi.fn();
  render(<BarcodeScannerDialog open onClose={onClose} onDetected={onDetected} />);
  return { onClose, onDetected };
}

describe('BarcodeScannerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('degrades to manual entry when the camera is unavailable', async () => {
    renderDialog();
    await waitFor(() =>
      expect(screen.getByTestId('barcode-scanner-no-camera')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('barcode-manual-input')).toBeInTheDocument();
  });

  it('accepts a checksum-valid manual barcode (whitespace/hyphens tolerated)', async () => {
    const { onDetected, onClose } = renderDialog();
    fireEvent.change(screen.getByTestId('barcode-manual-input'), {
      target: { value: ' 729-0000-066318 ' },
    });
    fireEvent.click(screen.getByTestId('barcode-manual-submit'));
    expect(onDetected).toHaveBeenCalledWith('7290000066318');
    expect(onClose).toHaveBeenCalled();
  });

  it('rejects an invalid check digit with an inline alert', () => {
    const { onDetected } = renderDialog();
    fireEvent.change(screen.getByTestId('barcode-manual-input'), {
      target: { value: '7290000066317' },
    });
    fireEvent.click(screen.getByTestId('barcode-manual-submit'));
    expect(onDetected).not.toHaveBeenCalled();
    expect(screen.getByTestId('barcode-manual-error')).toBeInTheDocument();
    // The field is linked to its error for AT users.
    expect(screen.getByTestId('barcode-manual-input')).toHaveAttribute('aria-invalid', 'true');
  });

  it('closes on Escape', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
