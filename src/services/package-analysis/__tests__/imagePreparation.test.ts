/**
 * The focus measure is the one piece of imagePreparation that can run without a
 * canvas, and it is the piece that decides whether a photo is worth reading.
 */

import { describe, expect, it } from 'vitest';

import { classifyFocus, laplacianVariance } from '../imagePreparation.ts';

const WIDTH = 64;
const HEIGHT = 64;

/** Crisp black/white stripes — what sharp printed text looks like to a Laplacian. */
function sharpStripes(): Uint8ClampedArray {
  const grey = new Uint8ClampedArray(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      grey[y * WIDTH + x] = Math.floor(x / 3) % 2 === 0 ? 0 : 255;
    }
  }
  return grey;
}

/** The same stripes smeared into a gradient — what motion blur does to them. */
function blurredStripes(): Uint8ClampedArray {
  const grey = new Uint8ClampedArray(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      grey[y * WIDTH + x] = 128 + Math.round(24 * Math.sin((x / WIDTH) * Math.PI * 2));
    }
  }
  return grey;
}

function flat(): Uint8ClampedArray {
  return new Uint8ClampedArray(WIDTH * HEIGHT).fill(200);
}

describe('laplacianVariance', () => {
  it('scores sharp edges far above blurred ones', () => {
    expect(laplacianVariance(sharpStripes(), WIDTH, HEIGHT)).toBeGreaterThan(
      laplacianVariance(blurredStripes(), WIDTH, HEIGHT) * 10,
    );
  });

  it('scores a featureless image at zero', () => {
    expect(laplacianVariance(flat(), WIDTH, HEIGHT)).toBe(0);
  });

  it('does not crash on an image too small to have a neighbourhood', () => {
    expect(laplacianVariance(new Uint8ClampedArray(4), 2, 2)).toBe(0);
  });
});

describe('classifyFocus', () => {
  it('calls a real photo of print sharp', () => {
    expect(classifyFocus(laplacianVariance(sharpStripes(), WIDTH, HEIGHT))).toBe('sharp');
  });

  it('calls a smeared photo blurred', () => {
    expect(classifyFocus(laplacianVariance(blurredStripes(), WIDTH, HEIGHT))).toBe('blurred');
  });

  it('calls a featureless photo blurred rather than sharp', () => {
    // Failing safe: an unmeasurable image must never be treated as a good read.
    expect(classifyFocus(0)).toBe('blurred');
  });

  it('has a middle band so borderline photos ask for a retake instead of failing', () => {
    expect(classifyFocus(120)).toBe('soft');
  });
});
