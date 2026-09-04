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

export interface ProductScanApi {
  readonly screen: ScreenState;
  readonly result: ProductLookupResult | null;
  readonly barcodeInFlight: string | null;
  check: (barcode: string) => Promise<void>;
  reset: () => void;
}

export function useProductScan(): ProductScanApi {
  const [screen, setScreen] = useState<ScreenState>('home');
  const [result, setResult] = useState<ProductLookupResult | null>(null);
  const [barcodeInFlight, setBarcodeInFlight] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    setResult(lookupResult);
    setBarcodeInFlight(null);
    setScreen('result');
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setResult(null);
    setBarcodeInFlight(null);
    setScreen('home');
  }, []);

  return { screen, result, barcodeInFlight, check, reset };
}
