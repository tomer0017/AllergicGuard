import { describe, expect, it } from 'vitest';

import {
  hasValidCheckDigit,
  isSameBarcode,
  normalizeBarcode,
  toComparableBarcode,
  validateBarcode,
} from '../barcode.ts';

describe('barcode validation', () => {
  it('accepts real EAN-13 barcodes', () => {
    for (const barcode of ['7290000066318', '7290004131074', '3017620422003']) {
      expect(validateBarcode(barcode).valid).toBe(true);
      expect(hasValidCheckDigit(barcode)).toBe(true);
    }
  });

  it('accepts EAN-8 and UPC-A', () => {
    expect(validateBarcode('96385074').valid).toBe(true);
    expect(validateBarcode('036000291452').valid).toBe(true);
  });

  it('rejects a wrong check digit — a misread barcode must never be looked up', () => {
    expect(validateBarcode('7290000066319').valid).toBe(false);
  });

  it('rejects unsupported lengths and empty input', () => {
    expect(validateBarcode('12345').valid).toBe(false);
    expect(validateBarcode('').valid).toBe(false);
    expect(validateBarcode('   ').valid).toBe(false);
  });

  it('strips separators scanners sometimes emit', () => {
    expect(normalizeBarcode(' 729-0000 066318 ')).toBe('7290000066318');
    expect(validateBarcode(' 729-0000 066318 ').valid).toBe(true);
  });
});

describe('toComparableBarcode / isSameBarcode', () => {
  it('treats a UPC-A and its zero-padded EAN-13 form as the same article', () => {
    // The real Skippy case: Open Food Facts stores 037600309417 as
    // 0037600309417, and rejecting that lost a product we actually had data for.
    expect(isSameBarcode('037600309417', '0037600309417')).toBe(true);
    expect(isSameBarcode('37600309417', '0037600309417')).toBe(true);
  });

  it('still rejects genuinely different products', () => {
    expect(isSameBarcode('7290000074184', '7290000446547')).toBe(false);
    expect(isSameBarcode('037600309417', '037600309418')).toBe(false);
  });

  it('ignores separators the scanner may emit', () => {
    expect(isSameBarcode('729-0000-074184', '7290000074184')).toBe(true);
  });

  it('normalizes an all-zero code without emptying it', () => {
    expect(toComparableBarcode('0000')).toBe('0');
  });
});
