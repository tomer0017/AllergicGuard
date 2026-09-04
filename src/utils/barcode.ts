/** Barcode normalization and validation (EAN-8 / EAN-13 / UPC-A / UPC-E). */

export type BarcodeValidation =
  | { readonly valid: true; readonly barcode: string; readonly format: 'EAN_8' | 'EAN_13' | 'UPC_A' | 'UPC_E' }
  | { readonly valid: false; readonly reason: string };

/** Strips whitespace and any non-digit characters scanners sometimes emit. */
export function normalizeBarcode(input: string): string {
  return input.replace(/\D+/g, '');
}

const SUPPORTED_LENGTHS: Record<number, 'EAN_8' | 'EAN_13' | 'UPC_A' | 'UPC_E'> = {
  8: 'EAN_8',
  12: 'UPC_A',
  13: 'EAN_13',
};

/**
 * GS1 mod-10 check digit. A barcode failing it was almost certainly misread,
 * and looking up a misread barcode could show a different product's allergens.
 */
export function hasValidCheckDigit(barcode: string): boolean {
  const digits = [...barcode].map(Number);
  if (digits.some(Number.isNaN)) return false;
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;

  // Weights alternate 3/1 from the right-most data digit outwards.
  let sum = 0;
  for (let index = digits.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += digits[index]! * weight;
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function validateBarcode(input: string): BarcodeValidation {
  const barcode = normalizeBarcode(input);
  if (barcode.length === 0) return { valid: false, reason: 'Barcode is empty' };

  const format = SUPPORTED_LENGTHS[barcode.length];
  if (!format) {
    return {
      valid: false,
      reason: `Unsupported barcode length ${barcode.length}; expected 8, 12 or 13 digits`,
    };
  }
  if (!hasValidCheckDigit(barcode)) {
    return { valid: false, reason: 'Check digit does not match — the barcode was probably misread' };
  }
  return { valid: true, barcode, format };
}

/** Israeli GS1 prefix — used only for display hints, never for safety decisions. */
export function isIsraeliPrefix(barcode: string): boolean {
  return barcode.startsWith('729');
}
