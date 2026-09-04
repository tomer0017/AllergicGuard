import type { AppError } from '../../domain/errors/appError.ts';
import type { ScannerState } from './useBarcodeScanner.ts';

interface ScannerPanelProps {
  readonly state: ScannerState;
  readonly error: AppError | null;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly onStart: () => void;
  readonly onStop: () => void;
}

const STATE_TEXT: Record<ScannerState, string> = {
  idle: 'סרקו את הברקוד שעל המוצר',
  requesting_camera: 'מבקשים גישה למצלמה…',
  scanning: 'כוונו את המצלמה אל הברקוד',
  barcode_detected: 'ברקוד זוהה',
  error: 'לא ניתן להפעיל את המצלמה',
};

/** Camera viewport. Contains no allergy logic — it only reports a barcode. */
export function ScannerPanel({ state, error, videoRef, onStart, onStop }: ScannerPanelProps) {
  const isLive = state === 'scanning' || state === 'requesting_camera';

  return (
    <section className="scanner" aria-label="סורק ברקוד">
      <div className={`scanner__viewport scanner__viewport--${state}`}>
        <video ref={videoRef} className="scanner__video" muted playsInline />
        {!isLive && (
          <div className="scanner__placeholder">
            <span className="scanner__placeholder-icon" aria-hidden="true">
              📷
            </span>
            <p className="scanner__placeholder-text">{STATE_TEXT[state]}</p>
          </div>
        )}
        {isLive && <div className="scanner__reticle" aria-hidden="true" />}
      </div>

      <p className="scanner__status" role="status">
        {STATE_TEXT[state]}
      </p>

      {error && (
        <p className="scanner__error" role="alert">
          {error.userMessage}
        </p>
      )}

      {isLive ? (
        <button type="button" className="button button--ghost" onClick={onStop}>
          עצירת הסריקה
        </button>
      ) : (
        <button type="button" className="button button--primary button--large" onClick={onStart}>
          הפעלת המצלמה וסריקה
        </button>
      )}
    </section>
  );
}
