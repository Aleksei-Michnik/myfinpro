import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReceiptUploadZone } from './ReceiptUploadZone';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const makeFile = (name = 'receipt.jpg') => new File(['x'], name, { type: 'image/jpeg' });

describe('ReceiptUploadZone', () => {
  it('fires onFiles for dropped files', () => {
    const onFiles = vi.fn();
    render(<ReceiptUploadZone onFiles={onFiles} onUrl={vi.fn()} />);
    fireEvent.drop(screen.getByTestId('receipt-dropzone'), {
      dataTransfer: { files: [makeFile()] },
    });
    expect(onFiles).toHaveBeenCalledWith([expect.any(File)]);
  });

  it('fires onFiles from the browse input and resets it for re-selection', () => {
    const onFiles = vi.fn();
    render(<ReceiptUploadZone onFiles={onFiles} onUrl={vi.fn()} />);
    const input = screen.getByTestId('receipt-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
  });

  it('exposes a camera input with environment capture for phones', () => {
    render(<ReceiptUploadZone onFiles={vi.fn()} onUrl={vi.fn()} />);
    const camera = screen.getByTestId('receipt-camera-input');
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(camera.getAttribute('accept')).toBe('image/*');
  });

  it('submits a trimmed URL and clears the field', () => {
    const onUrl = vi.fn();
    render(<ReceiptUploadZone onFiles={vi.fn()} onUrl={onUrl} />);
    const input = screen.getByTestId('receipt-url-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  https://r.example/x  ' } });
    fireEvent.click(screen.getByTestId('receipt-url-submit'));
    expect(onUrl).toHaveBeenCalledWith('https://r.example/x');
    expect(input.value).toBe('');
  });

  it('disables the URL submit for empty input and everything while pending', () => {
    const onFiles = vi.fn();
    render(<ReceiptUploadZone onFiles={onFiles} onUrl={vi.fn()} pending />);
    expect((screen.getByTestId('receipt-url-submit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('receipt-browse-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('receipt-camera-button') as HTMLButtonElement).disabled).toBe(true);
    // Drops are ignored while pending.
    fireEvent.drop(screen.getByTestId('receipt-dropzone'), {
      dataTransfer: { files: [makeFile()] },
    });
    expect(onFiles).not.toHaveBeenCalled();
  });
});
