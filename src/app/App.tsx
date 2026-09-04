import { lazy, Suspense, useState } from 'react';

import { ManualBarcodeInput } from '../features/manual-barcode/ManualBarcodeInput.tsx';
import { ResultScreen } from '../features/product-result/ResultScreen.tsx';
import { ScannerPanel } from '../features/scanner/ScannerPanel.tsx';
import { useBarcodeScanner } from '../features/scanner/useBarcodeScanner.ts';
import { appServices } from './appServices.ts';
import { useProductScan } from './useProductScan.ts';

/**
 * The debug panel is imported only when import.meta.env.DEV is true, so the
 * bundler drops it entirely from production builds — it cannot ship, not even
 * as unreachable code.
 */
const DebugPanel = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('../features/debug/DebugPanel.tsx')).DebugPanel }))
  : null;

export default function App() {
  const { config, logger } = appServices;
  const scan = useProductScan();
  const [manualOpen, setManualOpen] = useState(false);

  const scanner = useBarcodeScanner({
    logger,
    cooldownMs: config.scanner.duplicateScanCooldownMs,
    onBarcode: (barcode) => {
      setManualOpen(false);
      void scan.check(barcode);
    },
  });

  const handleScanAgain = () => {
    scan.reset();
    scanner.stop();
  };

  return (
    <div className="app" dir="rtl" lang="he">
      <header className="app__header">
        <h1 className="app__title">AllergicGuard</h1>
        <p className="app__subtitle">בדיקת מוצר לאלרגיית בוטנים</p>
      </header>

      <main className="app__main">
        {scan.screen === 'home' && (
          <>
            <ScannerPanel
              state={scanner.state}
              error={scanner.error}
              videoRef={scanner.videoRef}
              onStart={() => void scanner.start()}
              onStop={scanner.stop}
            />

            {manualOpen ? (
              <ManualBarcodeInput
                onSubmit={(barcode) => {
                  scanner.stop();
                  setManualOpen(false);
                  void scan.check(barcode);
                }}
                onCancel={() => setManualOpen(false)}
              />
            ) : (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setManualOpen(true)}
              >
                הזנת ברקוד ידנית
              </button>
            )}
          </>
        )}

        {scan.screen === 'looking_up' && (
          <section className="loading" aria-live="polite">
            <div className="loading__spinner" aria-hidden="true" />
            <p className="loading__text">בודקים את המוצר…</p>
            <p className="loading__barcode">{scan.barcodeInFlight}</p>
          </section>
        )}

        {scan.screen === 'result' && scan.result && (
          <ResultScreen
            result={scan.result}
            packageScan={scan.packageScan}
            onScanAgain={handleScanAgain}
          />
        )}
      </main>

      <footer className="app__footer">
        <p>
          הכלי מסייע בבדיקת מידע ואינו מחליף בדיקת סימון האלרגנים שעל האריזה.
        </p>
      </footer>

      {config.debugPanelEnabled && DebugPanel && (
        <Suspense fallback={null}>
          <DebugPanel result={scan.result} logs={logger.getEntries(scan.result?.requestId)} />
        </Suspense>
      )}
    </div>
  );
}
