/**
 * Browser-side image preparation for OCR.
 *
 * Phone cameras produce 3-4000px JPEGs. Feeding those straight into a WASM OCR
 * engine on a mid-range Android is slow and memory-hungry, while shrinking too
 * far destroys the small print on an allergen panel. We resize to a bounded
 * long edge and convert to greyscale with a mild contrast stretch, which is
 * what Tesseract's binarizer wants.
 *
 * The image never leaves the device: everything here is canvas work.
 */

export interface PreparedImage {
  /** Canvas-derived bitmap ready for the OCR engine. */
  readonly source: Blob;
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly warnings: readonly string[];
}

/** Long edge fed to the OCR engine — enough for 8pt print, small enough to be fast. */
const TARGET_LONG_EDGE = 1600;
/**
 * Below this the photo cannot hold legible allergen print. It is a warning, not
 * a rejection: a small photo that still reads "PEANUT" must escalate to RED.
 */
const MIN_USABLE_LONG_EDGE = 600;

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

/** Greyscale + contrast stretch, applied in place on the canvas pixel buffer. */
function enhance(context: CanvasRenderingContext2D, width: number, height: number): void {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const grey = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
    data[i] = grey;
    if (grey < min) min = grey;
    if (grey > max) max = grey;
  }

  // A flat histogram means an out-of-focus or evenly-lit-but-blank photo; the
  // stretch would only amplify noise, so leave those pixels alone.
  const range = max - min;
  const scale = range > 24 ? 255 / range : 0;

  for (let i = 0; i < data.length; i += 4) {
    const grey = data[i]!;
    const value = scale === 0 ? grey : Math.max(0, Math.min(255, (grey - min) * scale));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  context.putImageData(image, 0, 0);
}

export async function prepareImageForOcr(image: Blob): Promise<PreparedImage> {
  const warnings: string[] = [];
  const { bitmap, width, height } = await decode(image);

  const longEdge = Math.max(width, height);
  if (longEdge === 0) throw new Error('Image has no dimensions');
  if (longEdge < MIN_USABLE_LONG_EDGE) {
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

  try {
    enhance(context, targetWidth, targetHeight);
  } catch {
    // A tainted or oversized buffer must not break the scan; OCR still works
    // on the un-enhanced image, it is only slightly less accurate.
    warnings.push('Contrast enhancement was skipped for this image.');
  }

  const source = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas could not be encoded'))),
      'image/png',
    );
  });

  return {
    source,
    width: targetWidth,
    height: targetHeight,
    originalWidth: width,
    originalHeight: height,
    warnings,
  };
}
