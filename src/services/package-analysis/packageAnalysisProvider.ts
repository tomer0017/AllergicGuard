/**
 * The contract every package-photo analyzer implements.
 *
 * Mirrors the ProductDataProvider design: a provider only produces normalized
 * evidence, it never makes a decision. Adding a Vision provider (a Gemini or
 * OpenAI proxy, a native ML Kit bridge) means implementing this interface and
 * routing the recognized text through `analyzePackageText`; no UI, no service
 * and no safety code changes.
 *
 * CRITICAL RULE — see domain/package/packageEvidence.ts for the enforcement:
 * a provider may escalate to RED, it can never create GREEN.
 */

import type { AppError } from '../../domain/errors/appError.ts';
import type { PackageEvidence } from '../../domain/package/packageEvidence.ts';
import type { Logger } from '../../infrastructure/logging/logger.ts';

export interface PackageAnalysisContext {
  readonly requestId: string;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
  /** Barcode the photo belongs to, for correlation only. */
  readonly barcode?: string;
  /** 0-1 progress from a long-running engine, for the UI. */
  readonly onProgress?: (progress: number, stage: string) => void;
}

export interface PackageAnalysisDiagnostics {
  readonly providerId: string;
  readonly providerName: string;
  readonly requestId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly imageBytes: number;
  readonly imageType: string;
  readonly extractedTextLength: number;
  readonly warnings: readonly string[];
}

export type PackageAnalysisResult =
  | {
      readonly status: 'success';
      readonly evidence: PackageEvidence;
      readonly diagnostics: PackageAnalysisDiagnostics;
    }
  | {
      readonly status: 'error';
      readonly error: AppError;
      readonly diagnostics: PackageAnalysisDiagnostics;
    };

export interface PackageAnalysisProvider {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Shown to the user under "שיטת ניתוח". */
  readonly analysisMethod: string;
  analyze(image: Blob, context: PackageAnalysisContext): Promise<PackageAnalysisResult>;
}
