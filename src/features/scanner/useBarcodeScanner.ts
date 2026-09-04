/**
 * Camera + barcode scanning hook.
 *
 * Explicit state machine:
 *   idle -> requesting_camera -> scanning -> barcode_detected -> (caller) -> idle
 *                                        \-> error
 *
 * Guards implemented here:
 *  - scan lock: only one barcode is emitted until the caller resumes,
 *  - cooldown: the same barcode is ignored for a configurable window,
 *  - permission and "no camera" handling with Hebrew user messages,
 *  - full track shutdown on unmount so the camera light always turns off.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createAppError, type AppError } from '../../domain/errors/appError.ts';
import type { Logger } from '../../infrastructure/logging/logger.ts';
import { validateBarcode } from '../../utils/barcode.ts';
import { createBarcodeReader, type BarcodeReader, type ReaderKind } from './barcodeReader.ts';

export type ScannerState =
  | 'idle'
  | 'requesting_camera'
  | 'scanning'
  | 'barcode_detected'
  | 'error';

const FRAME_INTERVAL_MS = 250;

export interface UseBarcodeScannerOptions {
  readonly logger: Logger;
  readonly cooldownMs: number;
  readonly onBarcode: (barcode: string) => void;
}

export interface BarcodeScannerApi {
  readonly state: ScannerState;
  readonly error: AppError | null;
  readonly readerKind: ReaderKind | null;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => Promise<void>;
  stop: () => void;
}

export function useBarcodeScanner(options: UseBarcodeScannerOptions): BarcodeScannerApi {
  const { logger, cooldownMs, onBarcode } = options;

  const [state, setState] = useState<ScannerState>('idle');
  const [error, setError] = useState<AppError | null>(null);
  const [readerKind, setReaderKind] = useState<ReaderKind | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<BarcodeReader | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockedRef = useRef(false);
  const lastScanRef = useRef<{ barcode: string; at: number } | null>(null);
  // Kept in a ref so restarting the camera is not required when the callback
  // identity changes between renders.
  const onBarcodeRef = useRef(onBarcode);
  useEffect(() => {
    onBarcodeRef.current = onBarcode;
  }, [onBarcode]);

  const releaseCamera = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    readerRef.current?.dispose();
    readerRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    releaseCamera();
    lockedRef.current = false;
    setState('idle');
  }, [releaseCamera]);

  const handleDetection = useCallback(
    (rawValue: string) => {
      const validation = validateBarcode(rawValue);
      if (!validation.valid) {
        logger.debug('SCAN', 'ignored unreadable barcode', { rawValue, reason: validation.reason });
        return;
      }
      const { barcode } = validation;

      const previous = lastScanRef.current;
      if (previous && previous.barcode === barcode && Date.now() - previous.at < cooldownMs) {
        return; // Debounce: the camera sees the same barcode many times a second.
      }

      lockedRef.current = true; // Scan lock: stop emitting until the caller resumes.
      lastScanRef.current = { barcode, at: Date.now() };
      releaseCamera();
      setState('barcode_detected');
      logger.info('SCAN', 'barcode detected', { barcode, format: validation.format });
      onBarcodeRef.current(barcode);
    },
    [cooldownMs, logger, releaseCamera],
  );

  const start = useCallback(async () => {
    releaseCamera();
    lockedRef.current = false;
    setError(null);
    setState('requesting_camera');

    if (!navigator.mediaDevices?.getUserMedia) {
      const appError = createAppError(
        'CAMERA_NOT_AVAILABLE',
        'navigator.mediaDevices.getUserMedia is unavailable (needs HTTPS or localhost)',
      );
      logger.error('SCAN', 'camera unavailable', { code: appError.code });
      setError(appError);
      setState('error');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : '';
      const appError =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? createAppError('CAMERA_PERMISSION_DENIED', `getUserMedia rejected: ${name}`, { cause })
          : createAppError('CAMERA_NOT_AVAILABLE', `getUserMedia failed: ${name || String(cause)}`, { cause });
      logger.error('SCAN', 'camera start failed', { code: appError.code });
      setError(appError);
      setState('error');
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      releaseCamera();
      return;
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    try {
      await video.play();
    } catch (cause) {
      logger.warn('SCAN', 'video autoplay was blocked', { error: String(cause) });
    }

    try {
      const reader = await createBarcodeReader();
      readerRef.current = reader;
      setReaderKind(reader.kind);
      logger.info('SCAN', 'scanner ready', { reader: reader.kind });
    } catch (cause) {
      const appError = createAppError('BARCODE_DECODE_FAILED', `Failed to initialise a barcode reader: ${String(cause)}`, { cause });
      logger.error('SCAN', 'reader init failed', { code: appError.code });
      releaseCamera();
      setError(appError);
      setState('error');
      return;
    }

    setState('scanning');

    let busy = false;
    timerRef.current = setInterval(() => {
      if (busy || lockedRef.current) return;
      const currentVideo = videoRef.current;
      const reader = readerRef.current;
      if (!currentVideo || !reader || currentVideo.readyState < 2) return;
      busy = true;
      void reader
        .readFrom(currentVideo)
        .then((value) => {
          if (value && !lockedRef.current) handleDetection(value);
        })
        .catch((cause: unknown) => {
          logger.debug('SCAN', 'frame decode failed', { error: String(cause) });
        })
        .finally(() => {
          busy = false;
        });
    }, FRAME_INTERVAL_MS);
  }, [handleDetection, logger, releaseCamera]);

  useEffect(() => releaseCamera, [releaseCamera]);

  return { state, error, readerKind, videoRef, start, stop };
}
