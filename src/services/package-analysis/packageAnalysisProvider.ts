/**
 * Future extension point: analyzing a photo of the package's allergen panel.
 *
 * NOT IMPLEMENTED IN THE MVP — this file exists only to fix the contract so a
 * future implementation cannot accidentally weaken the safety model.
 *
 * CRITICAL RULE
 * -------------
 * Vision/OCR may escalate a product to RED. It must NEVER independently create
 * GREEN. "No peanut detected by the model" is not evidence of absence: the photo
 * may be blurry, cropped, or of the wrong panel.
 *
 * This is enforced structurally rather than by convention: the returned evidence
 * is a ProductEvidence with sourceType 'package_scan', and an implementation may
 * only set `mayContainDataStatus: 'reported'` when it actually read a complete
 * precautionary-labelling statement. Anything less must be 'empty', which the
 * safety engine treats as unknown and therefore refuses to clear.
 */

import type { ProductEvidence } from '../../domain/product/productEvidence.ts';

export interface PackageAnalysisResult {
  readonly evidence: ProductEvidence;
  /** Raw text the OCR produced, for transparency and debugging. */
  readonly recognizedText?: string;
}

export interface PackageAnalysisProvider {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  analyze(image: Blob): Promise<PackageAnalysisResult>;
}
