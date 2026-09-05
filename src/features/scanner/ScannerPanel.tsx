import { Camera, ScanLine, X } from 'lucide-react';

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
  idle: 'כוונו את הברקוד אל תוך המסגרת',
  requesting_camera: 'מבקשים גישה למצלמה…',
  scanning: 'כוונו את הברקוד אל תוך המסגרת',
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
            <Camera size={34} strokeWidth={1.75} aria-hidden="true" />
            <p className="scanner__placeholder-text">סריקת ברקוד</p>
          </div>
        )}
        {isLive && <div className="scanner__reticle" aria-hidden="true" />}
      </div>

      <p className="scanner__status" role="status">
        {error ? error.userMessage : STATE_TEXT[state]}
      </p>

      {isLive ? (
        <button type="button" className="btn btn--quiet" onClick={onStop}>
          <X size={18} aria-hidden="true" />
          עצירת הסריקה
        </button>
      ) : (
        <button type="button" className="btn btn--primary btn--xl" onClick={onStart}>
          <ScanLine size={20} aria-hidden="true" />
          הפעלת המצלמה
        </button>
      )}
    </section>
  );
}
