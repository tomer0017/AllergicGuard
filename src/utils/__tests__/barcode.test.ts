import { describe, expect, it } from 'vitest';

import { hasValidCheckDigit, normalizeBarcode, validateBarcode } from '../barcode.ts';

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
