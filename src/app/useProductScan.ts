/**
 * Screen-level state machine for one scan cycle.
 *
 * home -> looking_up -> result -> (scan again) -> home
 *
 * All decision-making lives in ProductLookupService and the safety engine;
 * this hook only sequences the UI and cancels in-flight lookups.
 */

import { useCallback, useRef, useState } from 'react';

import { assessPeanutRisk } from '../domain/allergy/assessAllergenRisk.ts';
import type { AppError } from '../domain/errors/appError.ts';
import { toAppError } from '../domain/errors/appError.ts';
import { createRequestId } from '../infrastructure/logging/logger.ts';
import type { ProductLookupResult } from '../services/product-data/productLookupService.ts';
import { appServices } from './appServices.ts';

/**
 * Last-resort result for an unexpected failure inside the lookup pipeline.
 * A crash must surface as ORANGE ("check the package"), never as a spinner that
 * never resolves and never as anything a user could read as clearance.
 */
function buildFailsafeResult(requestId: string, barcode: string, cause: unknown): ProductLookupResult {
  const error = toAppError(cause);
  appServices.logger.error('LOOKUP', 'lookup pipeline threw unexpectedly', {
    requestId,
    barcode,
    technicalMessage: error.technicalMessage,
  });
  return {
    requestId,
    barcode,
    allergen: 'peanut',
    product: null,
    assessment: assessPeanutRisk({ evidence: [] }),
    evidence: [],
    providerResults: [],
    conflicts: [],
    generatedAt: new Date().toISOString(),
    inputError: error,
  };
}

export type ScreenState = 'home' | 'looking_up' | 'result';

export type PackageScanState = 'idle' | 'analyzing';

export interface PackageScanApi {
  /** False when no analysis provider is enabled in this build. */
  readonly available: boolean;
  readonly state: PackageScanState;
  /** 0-1, from the OCR engine. */
  readonly progress: number;
  /** Set when the last analysis failed. Cleared when a new one starts. */
  readonly error: AppError | null;
  analyze: (image: Blob) => Promise<void>;
  clearError: () => void;
}

export interface ProductScanApi {
  readonly screen: ScreenState;
  readonly result: ProductLookupResult | null;
  readonly barcodeInFlight: string | null;
  readonly packageScan: PackageScanApi;
  check: (barcode: string) => Promise<void>;
  reset: () => void;
}

export function useProductScan(): ProductScanApi {
  const [screen, setScreen] = useState<ScreenState>('home');
  const [result, setResult] = useState<ProductLookupResult | null>(null);
  const [barcodeInFlight, setBarcodeInFlight] = useState<string | null>(null);
  const [packageState, setPackageState] = useState<PackageScanState>('idle');
  const [packageProgress, setPackageProgress] = useState(0);
  const [packageError, setPackageError] = useState<AppError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Read inside analyze() so the callback never captures a stale result. */
  const resultRef = useRef<ProductLookupResult | null>(null);

  const check = useCallback(async (barcode: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const requestId = createRequestId();
    setBarcodeInFlight(barcode);
    setScreen('looking_up');

    let lookupResult: ProductLookupResult;
    try {
      lookupResult = await appServices.lookupService.lookup(barcode, {
        requestId,
        signal: controller.signal,
      });
    } catch (cause) {
      lookupResult = buildFailsafeResult(requestId, barcode, cause);
    }

    if (controller.signal.aborted) return;
    resultRef.current = lookupResult;
    setResult(lookupResult);
    setBarcodeInFlight(null);
    setPackageState('idle');
    setPackageProgress(0);
    setPackageError(null);
    setScreen('result');
  }, []);

  /**
   * Analyze a photo of the package and fold the finding into the current
   * result. The merge itself is ProductLookupService's, so the same pure safety
   * engine that judged the barcode judges the combined evidence.
   */
  const analyzePackage = useCallback(async (image: Blob) => {
    const current = resultRef.current;
    if (!current) return;

    setPackageError(null);
    setPackageProgress(0);
    setPackageState('analyzing');

    try {
      const outcome = await appServices.packageScanService.analyze(image, {
        requestId: current.requestId,
        barcode: current.barcode,
        onProgress: (progress) => setPackageProgress(progress),
      });

      if (outcome.status === 'error') {
        // A failed analysis leaves the barcode result exactly as it was.
        // It can never soften an existing verdict.
        setPackageError(outcome.error);
        return;
      }

      const merged = appServices.lookupService.applyPackageEvidence(current, outcome.evidence, {
        requestId: current.requestId,
      });
      resultRef.current = merged;
      setResult(merged);
    } catch (cause) {
      const error = toAppError(cause, 'package-scan');
      appServices.logger.error('PACKAGE_SCAN', 'package scan failed unexpectedly', {
        requestId: current.requestId,
        technicalMessage: error.technicalMessage,
      });
      setPackageError(error);
    } finally {
      setPackageState('idle');
      setPackageProgress(0);
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resultRef.current = null;
    setResult(null);
    setPackageState('idle');
    setPackageProgress(0);
    setPackageError(null);
    setBarcodeInFlight(null);
    setScreen('home');
  }, []);

  return {
    screen,
    result,
    barcodeInFlight,
    packageScan: {
      available: appServices.packageScanService.available,
      state: packageState,
      progress: packageProgress,
      error: packageError,
      analyze: analyzePackage,
      clearError: () => setPackageError(null),
    },
    check,
    reset,
  };
}
