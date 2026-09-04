/**
 * Barcode reading strategy.
 *
 * Prefers the native BarcodeDetector API (fast, hardware-accelerated, no
 * bundle cost) and falls back to ZXing, which is loaded lazily so browsers with
 * native support never download it.
 */

import {
  getBarcodeDetectorConstructor,
  SUPPORTED_BARCODE_FORMATS,
  type BarcodeDetectorLike,
} from './barcodeDetectorTypes.ts';

export type ReaderKind = 'native' | 'zxing';

export interface BarcodeReader {
  readonly kind: ReaderKind;
  /** Returns the raw barcode value, or null when nothing was decoded. */
  readFrom(video: HTMLVideoElement): Promise<string | null>;
  dispose(): void;
}

class NativeBarcodeReader implements BarcodeReader {
  readonly kind = 'native' as const;
  private readonly detector: BarcodeDetectorLike;

  constructor(detector: BarcodeDetectorLike) {
    this.detector = detector;
  }

  async readFrom(video: HTMLVideoElement): Promise<string | null> {
    const results = await this.detector.detect(video);
    return results.length > 0 ? (results[0]?.rawValue ?? null) : null;
  }

  dispose(): void {
    // Nothing to release.
  }
}

class ZXingBarcodeReader implements BarcodeReader {
  readonly kind = 'zxing' as const;
  private canvas: HTMLCanvasElement | null = null;
  private readonly decode: (canvas: HTMLCanvasElement) => string | null;

  constructor(decode: (canvas: HTMLCanvasElement) => string | null) {
    this.decode = decode;
  }

  async readFrom(video: HTMLVideoElement): Promise<string | null> {
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    if (!this.canvas) this.canvas = document.createElement('canvas');
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    return this.decode(this.canvas);
  }

  dispose(): void {
    this.canvas = null;
  }
}

export async function createBarcodeReader(): Promise<BarcodeReader> {
  const NativeDetector = getBarcodeDetectorConstructor();
  if (NativeDetector) {
    try {
      const supported = (await NativeDetector.getSupportedFormats?.()) ?? [];
      const usable =
        supported.length === 0 ||
        SUPPORTED_BARCODE_FORMATS.some((format) => supported.includes(format));
      if (usable) {
        return new NativeBarcodeReader(
          new NativeDetector({ formats: [...SUPPORTED_BARCODE_FORMATS] }),
        );
      }
    } catch {
      // Fall through to ZXing.
    }
  }

  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ]);
  const reader = new BrowserMultiFormatReader(hints);

  return new ZXingBarcodeReader((canvas) => {
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      // ZXing throws NotFoundException on every frame without a barcode.
      return null;
    }
  });
}
