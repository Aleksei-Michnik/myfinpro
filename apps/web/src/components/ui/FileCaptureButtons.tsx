'use client';

// Phase 8.25 — THE file-capture mechanism (design §3.5): a browse + camera
// button pair over two hidden inputs. Extracted from ReceiptUploadZone so
// every "pick or photograph a file" surface (receipt intake, attach-to-
// transaction, product pictures) shares one implementation. The camera
// input's `capture` attribute opens the camera directly on phones; desktop
// browsers fall back to a file picker.

import { useImperativeHandle, useRef, type Ref } from 'react';
import { Button } from '@/components/ui/Button';

export interface FileCaptureButtonsHandle {
  /** Open the browse picker programmatically (e.g. a surrounding dropzone). */
  openPicker(): void;
}

export interface FileCaptureButtonsProps {
  /** `accept` of the browse input; the camera input always takes `image/*`. */
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles(files: File[], source: 'picker' | 'camera'): void;
  browseLabel: string;
  cameraLabel: string;
  /** data-testids: `<prefix>-browse-button|-camera-button|-file-input|-camera-input`. */
  testIdPrefix: string;
  size?: 'sm' | 'md';
  variant?: 'secondary' | 'outline';
  ref?: Ref<FileCaptureButtonsHandle>;
}

export function FileCaptureButtons({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  browseLabel,
  cameraLabel,
  testIdPrefix,
  size = 'sm',
  variant = 'secondary',
  ref,
}: FileCaptureButtonsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ openPicker: () => fileInputRef.current?.click() }), []);

  const emit = (list: FileList | null, source: 'picker' | 'camera') => {
    const files = Array.from(list ?? []);
    if (files.length > 0) onFiles(files, source);
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        data-testid={`${testIdPrefix}-browse-button`}
      >
        {browseLabel}
      </Button>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => cameraInputRef.current?.click()}
        data-testid={`${testIdPrefix}-camera-button`}
      >
        {cameraLabel}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        data-testid={`${testIdPrefix}-file-input`}
        onChange={(e) => {
          emit(e.target.files, 'picker');
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid={`${testIdPrefix}-camera-input`}
        onChange={(e) => {
          emit(e.target.files, 'camera');
          e.target.value = '';
        }}
      />
    </>
  );
}
