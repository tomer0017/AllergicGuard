/**
 * Browser-side image preparation and a pragmatic quality estimate.
 *
 * Phone cameras produce 3-4000px JPEGs. Feeding those straight into a WASM OCR
 * engine on a mid-range Android is slow and memory-hungry, while shrinking too
 * far destroys the small print on an allergen panel. We resize to a bounded
 * long edge, convert to greyscale and stretch contrast — which is what
 * Tesseract's binarizer wants — and measure focus while the pixels are already
 * in hand.
 *
 * The image never leaves the device: everything here is canvas work.
 *
 * ON TUNING: preprocessing that is too aggressive makes OCR WORSE. Binarizing
 * ourselves, sharpening hard, or upscaling small images all lost accuracy in
 * testing against Tesseract's own adaptive thresholding, so this module stops
 * at resize + greyscale + a conservative contrast stretch.
 */

export type FocusVerdict = 'sharp' | 'soft' | 'blurred';

export interface ImageQualityMetrics {
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  /** Variance of the Laplacian — the standard cheap focus measure. */
  readonly focusScore: number;
  readonly focus: FocusVerdict;
  /** Spread of the greyscale histogram, 0-255. Low means flat/washed out. */
  readonly contrastRange: number;
  readonly tooSmall: boolean;
}

export interface PreparedImage {
  readonly source: Blob;
  readonly metrics: ImageQualityMetrics;
  readonly warnings: readonly string[];
}

/** Long edge fed to the OCR engine — enough for 8pt print, small enough to be fast. */
const TARGET_LONG_EDGE = 1600;
/**
 * Below this the photo cannot hold legible allergen print. It is a warning, not
 * a rejection: a small photo that still reads "PEANUT" must escalate to RED.
 */
const MIN_USABLE_LONG_EDGE = 600;

/**
 * Laplacian-variance thresholds, calibrated on greyscale, contrast-stretched
 * 1600px-long-edge images of printed labels. They are deliberately generous:
 * the cost of calling a usable photo "soft" is one extra tap, the cost of
 * accepting a blurred one is a wasted OCR pass that finds nothing.
 */
const BLURRED_BELOW = 60;
const SOFT_BELOW = 180;

async function decode(image: Blob): Promise<{ bitmap: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(image);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const url = URL.createObjectURL(image);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image could not be decoded'));
      img.src = url;
    });
    return { bitmap: element, width: element.naturalWidth, height: element.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Variance of the Laplacian over a greyscale buffer.
 *
 * A sharp photo has strong second derivatives at every letter edge; a blurred
 * one has almost none, so the variance collapses. Sampling every second pixel
 * keeps this well under a frame on a phone without changing the verdict.
 */
export function laplacianVariance(grey: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = y * width + x;
      const value =
        4 * grey[index]! -
        grey[index - 1]! -
        grey[index + 1]! -
        grey[index - width]! -
        grey[index + width]!;
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

export function classifyFocus(focusScore: number): FocusVerdict {
  if (focusScore < BLURRED_BELOW) return 'blurred';
  if (focusScore < SOFT_BELOW) return 'soft';
  return 'sharp';
}

interface EnhanceResult {
  readonly grey: Uint8ClampedArray;
  readonly contrastRange: number;
}

/** Greyscale + conservative contrast stretch, applied in place on the canvas. */
function enhance(context: CanvasRenderingContext2D, width: number, height: number): EnhanceResult {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const grey = new Uint8ClampedArray(width * height);

  let min = 255;
  let max = 0;
  for (let i = 0, g = 0; i < data.length; i += 4, g += 1) {
    const value = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
    grey[g] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // A flat histogram means an out-of-focus or evenly-lit-but-blank photo; the
  // stretch would only amplify noise, so leave those pixels alone.
  const contrastRange = max - min;
  const scale = contrastRange > 24 ? 255 / contrastRange : 0;

  for (let i = 0, g = 0; i < data.length; i += 4, g += 1) {
    const stretched = scale === 0 ? grey[g]! : Math.max(0, Math.min(255, (grey[g]! - min) * scale));
    grey[g] = stretched;
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
    data[i + 3] = 255;
  }

  context.putImageData(image, 0, 0);
  return { grey, contrastRange };
}

export async function prepareImageForOcr(image: Blob): Promise<PreparedImage> {
  const warnings: string[] = [];
  const { bitmap, width, height } = await decode(image);

  const longEdge = Math.max(width, height);
  if (longEdge === 0) throw new Error('Image has no dimensions');

  const tooSmall = longEdge < MIN_USABLE_LONG_EDGE;
  if (tooSmall) {
    warnings.push(`Image is small (${width}x${height}); small print may be unreadable.`);
  }

  const scale = longEdge > TARGET_LONG_EDGE ? TARGET_LONG_EDGE / longEdge : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context is unavailable');

  context.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  let focusScore = Number.NaN;
  let contrastRange = Number.NaN;
  try {
    const enhanced = enhance(context, targetWidth, targetHeight);
    contrastRange = enhanced.contrastRange;
    focusScore = laplacianVariance(enhanced.grey, targetWidth, targetHeight);
  } catch {
    // A tainted or oversized buffer must not break the scan; OCR still works on
    // the un-enhanced image, and an unmeasurable focus score is treated as
    // "unknown", never as "sharp".
    warnings.push('Contrast enhancement and focus measurement were skipped for this image.');
  }

  const focus = Number.isFinite(focusScore) ? classifyFocus(focusScore) : 'soft';
  if (focus === 'blurred') warnings.push(`Image looks out of focus (focus score ${focusScore.toFixed(0)}).`);

  const source = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas could not be encoded'))),
      'image/png',
    );
  });

  return {
    source,
    metrics: {
      width: targetWidth,
      height: targetHeight,
      originalWidth: width,
      originalHeight: height,
      focusScore,
      focus,
      contrastRange,
      tooSmall,
    },
    warnings,
  };
}
