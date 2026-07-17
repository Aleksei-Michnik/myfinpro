import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileCaptureButtons, type FileCaptureButtonsHandle } from './FileCaptureButtons';

const onFiles = vi.fn();

const renderButtons = (over: Partial<Parameters<typeof FileCaptureButtons>[0]> = {}) =>
  render(
    <FileCaptureButtons
      accept="image/jpeg,image/png"
      multiple
      onFiles={onFiles}
      browseLabel="Browse"
      cameraLabel="Camera"
      testIdPrefix="capture"
      {...over}
    />,
  );

describe('FileCaptureButtons (8.25)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits picked files with source=picker and resets the input', () => {
    renderButtons();
    const input = screen.getByTestId('capture-file-input') as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png');
    expect(input.multiple).toBe(true);
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file], 'picker');
    expect(input.value).toBe('');
  });

  it('emits camera shots with source=camera from the capture input', () => {
    renderButtons();
    const input = screen.getByTestId('capture-camera-input') as HTMLInputElement;
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.accept).toBe('image/*');
    const shot = new File(['y'], 'shot.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [shot] } });
    expect(onFiles).toHaveBeenCalledWith([shot], 'camera');
  });

  it('ignores empty selections', () => {
    renderButtons();
    fireEvent.change(screen.getByTestId('capture-file-input'), { target: { files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('disables both buttons when disabled', () => {
    renderButtons({ disabled: true });
    expect((screen.getByTestId('capture-browse-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('capture-camera-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('exposes openPicker for surrounding dropzones', () => {
    const ref = createRef<FileCaptureButtonsHandle>();
    renderButtons({ ref });
    const input = screen.getByTestId('capture-file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    ref.current?.openPicker();
    expect(click).toHaveBeenCalled();
  });
});
