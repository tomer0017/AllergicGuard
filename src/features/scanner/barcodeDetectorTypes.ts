/**
 * Minimal typings for the native BarcodeDetector API, which is not part of
 * the TypeScript DOM lib yet. Only the members we actually use are declared.
 */

export interface DetectedBarcode {
  readonly rawValue: string;
  readonly format: string;
}

export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export const SUPPORTED_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export function getBarcodeDetectorConstructor(): BarcodeDetectorConstructor | undefined {
  const candidate = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return typeof candidate === 'function' ? candidate : undefined;
}
