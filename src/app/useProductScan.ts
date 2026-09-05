/**
 * Screen-level state machine for one product session.
 *
 *   home ─scan─▶ looking_up ─▶ confirming ─confirm─▶ result
 *                                  └──reject──▶ home (scanner reopens)
 *
 * The confirmation step exists because a barcode can be misread, and because a
 * scanner can pick up a neighbouring package on the shelf. It confirms
 * BARCODE ↔ PHYSICAL PRODUCT and nothing else — it is never an approval that
 * the product is safe.
 *
 * All decision-making lives in ProductLookupService and the safety engine;
 * this hook only sequences the UI and cancels in-flight work.
 */

import { useCallback, useRef, useState } from 'react';

import { assessPeanutRisk } from '../domain/allergy/assessAllergenRisk.ts';
import type { AppError } from '../domain/errors/appError.ts';
import { toAppError } from '../domain/errors/appError.ts';
import type { ImageQuality } from '../domain/package/packageEvidence.ts';
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

export type ScreenState = 'home' | 'looking_up' | 'confirming' | 'result';

export type PackageScanState = 'idle' | 'analyzing';

/**
 * Why the app is asking for another photo. Every value here means "we did not
 * read the label", never "the product looks fine".
 */
export interface RetakeRequest {
  readonly reason: 'poor_quality' | 'partial_read' | 'analysis_failed';
  readonly quality?: ImageQuality;
  readonly error?: AppError;
}

export interface PackageScanApi {
  /** False when no analysis provider is enabled in this build. */
  readonly available: boolean;
  readonly state: PackageScanState;
  /** 0-1, from the OCR engine. */
  readonly progress: number;
  /** Set when the last analysis could not read the label. */
  readonly retake: RetakeRequest | null;
  /** How many photos have been analyzed in this product session. */
  readonly attempts: number;
  /** Analysis starts immediately — there is no separate confirm step. */
  analyze: (image: Blob) => Promise<void>;
  dismissRetake: () => void;
}

export interface ProductScanApi {
  readonly screen: ScreenState;
  readonly result: ProductLookupResult | null;
  readonly barcodeInFlight: string | null;
  /** Result awaiting the user's "is this the product?" answer. */
  readonly pendingConfirmation: ProductLookupResult | null;
  readonly packageScan: PackageScanApi;
  check: (barcode: string) => Promise<void>;
  /** Start a check from a package photo alone, with no barcode. */
  startPackagePhotoCheck: () => void;
  confirmProduct: () => void;
  rejectProduct: () => void;
  reset: () => void;
}

export function useProductScan(): ProductScanApi {
  const [screen, setScreen] = useState<ScreenState>('home');
  const [result, setResult] = useState<ProductLookupResult | null>(null);
  const [pending, setPending] = useState<ProductLookupResult | null>(null);
  const [barcodeInFlight, setBarcodeInFlight] = useState<string | null>(null);
  const [packageState, setPackageState] = useState<PackageScanState>('idle');
  const [packageProgress, setPackageProgress] = useState(0);
  const [retake, setRetake] = useState<RetakeRequest | null>(null);
  const [attempts, setAttempts] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Read inside analyze() so the callback never captures a stale result. */
  const resultRef = useRef<ProductLookupResult | null>(null);

  const clearPackageState = useCallback(() => {
    setPackageState('idle');
    setPackageProgress(0);
    setRetake(null);
    setAttempts(0);
  }, []);

  const check = useCallback(
    async (barcode: string) => {
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

      appServices.logger.info('PRODUCT', 'lookup completed, awaiting confirmation', {
        requestId,
        barcode,
        productName: lookupResult.product?.displayName,
        identified: lookupResult.product !== null,
      });

      // The verdict is NOT shown yet: the user first says whether this is the
      // package in their hand.
      clearPackageState();
      resultRef.current = null;
      setResult(null);
      setPending(lookupResult);
      setBarcodeInFlight(null);
      setScreen('confirming');
    },
    [clearPackageState],
  );

  const confirmProduct = useCallback(() => {
    setPending((current) => {
      if (!current) return null;
      appServices.logger.info('CONFIRM', 'user confirmed the product', {
        requestId: current.requestId,
        barcode: current.barcode,
        productName: current.product?.displayName,
      });
      resultRef.current = current;
      setResult(current);
      setScreen('result');
      return null;
    });
  }, []);

  const rejectProduct = useCallback(() => {
    setPending((current) => {
      if (current) {
        // The lookup is discarded entirely: allergen data for the wrong product
        // is worse than no data at all.
        appServices.logger.warn('CONFIRM', 'user rejected the product — discarding lookup', {
          requestId: current.requestId,
          barcode: current.barcode,
          productName: current.product?.displayName,
        });
      }
      return null;
    });
    resultRef.current = null;
    setResult(null);
    clearPackageState();
    setScreen('home');
  }, [clearPackageState]);

  /**
   * Analyze a photo of the package and fold the finding into the current
   * result. Runs as soon as an image is chosen — there is no "analyze" button.
   * The merge itself is ProductLookupService's, so the same pure safety engine
   * that judged the barcode judges the combined evidence.
   */
  const analyzePackage = useCallback(async (image: Blob) => {
    const current = resultRef.current;
    if (!current) return;

    setRetake(null);
    setPackageProgress(0);
    setPackageState('analyzing');
    setAttempts((count) => count + 1);

    try {
      const outcome = await appServices.packageScanService.analyze(image, {
        requestId: current.requestId,
        barcode: current.barcode,
        onProgress: (progress) => setPackageProgress(progress),
      });

      if (outcome.status === 'error') {
        // A failed analysis leaves the barcode result exactly as it was.
        // It can never soften an existing verdict.
        setRetake({ reason: 'analysis_failed', error: outcome.error });
        return;
      }

      const evidence = outcome.evidence;
      const merged = appServices.lookupService.applyPackageEvidence(current, evidence, {
        requestId: current.requestId,
      });
      resultRef.current = merged;
      setResult(merged);

      // Ask for a better photo whenever we could not honestly claim to have
      // read the label — but never when the label already told us about
      // peanuts, because then there is nothing left to find.
      if (!evidence.explicitPeanutEvidence && evidence.imageQuality !== 'good') {
        setRetake({
          reason: evidence.imageQuality === 'poor' ? 'poor_quality' : 'partial_read',
          quality: evidence.imageQuality,
        });
      }
    } catch (cause) {
      const error = toAppError(cause, 'package-scan');
      appServices.logger.error('PACKAGE_SCAN', 'package scan failed unexpectedly', {
        requestId: current.requestId,
        technicalMessage: error.technicalMessage,
      });
      setRetake({ reason: 'analysis_failed', error });
    } finally {
      setPackageState('idle');
      setPackageProgress(0);
    }
  }, []);

  /**
   * Package-photo-only check: no barcode, no lookup, no confirmation step.
   *
   * For a user abroad, holding a product no database has heard of, or one whose
   * barcode will not scan. The starting verdict is NOT invented here — it comes
   * from the same pure engine with an empty evidence set, which by the existing
   * rules is `insufficient_data`. The photo is then merged through exactly the
   * same path as in the barcode flow, so every safety rule still applies and a
   * photo still cannot produce GREEN.
   */
  const startPackagePhotoCheck = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const requestId = createRequestId();
    const base: ProductLookupResult = {
      requestId,
      barcode: '',
      allergen: 'peanut',
      product: null,
      assessment: assessPeanutRisk({ evidence: [] }),
      evidence: [],
      providerResults: [],
      conflicts: [],
      generatedAt: new Date().toISOString(),
    };

    appServices.logger.info('PRODUCT', 'package-photo-only check started', { requestId });

    clearPackageState();
    setPending(null);
    setBarcodeInFlight(null);
    resultRef.current = base;
    setResult(base);
    setScreen('result');
  }, [clearPackageState]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resultRef.current = null;
    setResult(null);
    setPending(null);
    setBarcodeInFlight(null);
    clearPackageState();
    setScreen('home');
  }, [clearPackageState]);

  return {
    screen,
    result,
    barcodeInFlight,
    pendingConfirmation: pending,
    packageScan: {
      available: appServices.packageScanService.available,
      state: packageState,
      progress: packageProgress,
      retake,
      attempts,
      analyze: analyzePackage,
      dismissRetake: () => setRetake(null),
    },
    check,
    startPackagePhotoCheck,
    confirmProduct,
    rejectProduct,
    reset,
  };
}
