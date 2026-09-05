import { lazy, Suspense, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { HomeScreen } from '../features/home/HomeScreen.tsx';
import { ManualBarcodeInput } from '../features/manual-barcode/ManualBarcodeInput.tsx';
import { ProductConfirmation } from '../features/product-confirm/ProductConfirmation.tsx';
import { ResultScreen } from '../features/product-result/ResultScreen.tsx';
import { ScannerPanel } from '../features/scanner/ScannerPanel.tsx';
import { useBarcodeScanner } from '../features/scanner/useBarcodeScanner.ts';
import { BrandMark } from '../ui/BrandMark.tsx';
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

/** What the home area is showing. The scan session state machine is separate. */
type HomeView = 'menu' | 'scan' | 'manual';

const HOME_TITLE: Record<Exclude<HomeView, 'menu'>, string> = {
  scan: 'סריקת ברקוד',
  manual: 'הזנת ברקוד',
};

/**
 * There is no bottom navigation, on purpose.
 *
 * Every primary action already lives on Home, one tap away, and the app has
 * exactly one task: "can I use this product?". A tab bar would have added a
 * permanent 56px of chrome to duplicate buttons the user can already see, on
 * the same screens where vertical space decides whether the verdict is visible
 * without scrolling.
 */
export default function App() {
  const { config, logger } = appServices;
  const scan = useProductScan();
  const [homeView, setHomeView] = useState<HomeView>('menu');

  const scanner = useBarcodeScanner({
    logger,
    cooldownMs: config.scanner.duplicateScanCooldownMs,
    onBarcode: (barcode) => void scan.check(barcode),
  });

  // Opening the scanner view starts the camera: the user asked for the camera,
  // so making them tap a second button to get it would be pure friction.
  const { start: startScanner, stop: stopScanner } = scanner;
  useEffect(() => {
    if (homeView === 'scan' && scan.screen === 'home') void startScanner();
  }, [homeView, scan.screen, startScanner]);

  const goHome = () => {
    stopScanner();
    setHomeView('menu');
  };

  const handleScanAgain = () => {
    scan.reset();
    stopScanner();
    setHomeView('menu');
  };

  // Rejecting the identified product throws the lookup away and reopens the
  // camera, so the next scan starts from a clean slate.
  const handleReject = () => {
    scan.rejectProduct();
    setHomeView('scan');
  };

  const onHome = scan.screen === 'home';
  const showBack = onHome && homeView !== 'menu';
  const heading = onHome && homeView !== 'menu' ? HOME_TITLE[homeView] : null;

  return (
    <div className="app" dir="rtl" lang="he">
      {/* Home carries the brand; inner screens carry the task. */}
      {!(onHome && homeView === 'menu') && (
        <header className="topbar">
          {showBack ? (
            <button type="button" className="topbar__back" onClick={goHome} aria-label="חזרה">
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          ) : (
            <span className="topbar__slot" aria-hidden="true" />
          )}
          <div className="topbar__title">
            {heading ?? (
              <>
                <BrandMark size={24} />
                <span>AllergicGuard</span>
              </>
            )}
          </div>
          <span className="topbar__slot" aria-hidden="true" />
        </header>
      )}

      <main className="app__main">
        {onHome && homeView === 'menu' && (
          <HomeScreen
            onScan={() => setHomeView('scan')}
            onManual={() => setHomeView('manual')}
            onPackagePhoto={scan.startPackagePhotoCheck}
            packagePhotoAvailable={scan.packageScan.available}
          />
        )}

        {onHome && homeView === 'scan' && (
          <ScannerPanel
            state={scanner.state}
            error={scanner.error}
            videoRef={scanner.videoRef}
            onStart={() => void startScanner()}
            onStop={stopScanner}
          />
        )}

        {onHome && homeView === 'manual' && (
          <ManualBarcodeInput
            onSubmit={(barcode) => {
              stopScanner();
              void scan.check(barcode);
            }}
            onCancel={goHome}
          />
        )}

        {scan.screen === 'looking_up' && (
          <section className="loading" aria-live="polite">
            <span className="capture__spinner" aria-hidden="true" />
            <p className="loading__text">בודקים את המוצר…</p>
            <p className="loading__barcode" dir="ltr">
              {scan.barcodeInFlight}
            </p>
          </section>
        )}

        {scan.screen === 'confirming' && scan.pendingConfirmation && (
          <ProductConfirmation
            result={scan.pendingConfirmation}
            onConfirm={scan.confirmProduct}
            onReject={handleReject}
          />
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
        הכלי מסייע בבדיקת מידע ואינו מחליף בדיקת סימון האלרגנים שעל האריזה.
      </footer>

      {config.debugPanelEnabled && DebugPanel && (
        <Suspense fallback={null}>
          <DebugPanel result={scan.result} logs={logger.getEntries(scan.result?.requestId)} />
        </Suspense>
      )}
    </div>
  );
}
