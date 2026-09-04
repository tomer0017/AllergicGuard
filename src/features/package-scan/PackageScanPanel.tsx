import { useEffect, useRef, useState } from 'react';

import type { PackageScanApi } from '../../app/useProductScan.ts';
import type { AssessmentStatus } from '../../domain/allergy/assessment.ts';

interface PackageScanPanelProps {
  readonly packageScan: PackageScanApi;
  /** Drives how prominent the call to action is. */
  readonly status: AssessmentStatus;
  /** True once at least one photo has been analyzed for this product. */
  readonly hasPreviousScan: boolean;
}

/**
 * Camera / gallery capture for the allergen panel.
 *
 * The user always sees the photo before it is analyzed — a blurry shot is the
 * single most common reason OCR finds nothing, and finding nothing proves
 * nothing, so it is worth one extra tap to retake it.
 */
export function PackageScanPanel({ packageScan, status, hasPreviousScan }: PackageScanPanelProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  // File and preview URL move together, created in the change handler rather
  // than in an effect so the preview appears in the same render as the pick.
  const [selection, setSelection] = useState<{ file: File; url: string } | null>(null);

  // The effect owns revocation: it releases the previous URL when the pick
  // changes and the last one when the panel unmounts (a new scan, a RED).
  const previewUrl = selection?.url;
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const analyzing = packageScan.state === 'analyzing';
  const primary = status === 'insufficient_data';

  if (!packageScan.available) return null;

  const pick = (file: File | undefined) => {
    if (!file) return;
    packageScan.clearError();
    setSelection({ file, url: URL.createObjectURL(file) });
  };

  const runAnalysis = async () => {
    if (!selection) return;
    await packageScan.analyze(selection.file);
    // Keep the preview: after a scan that found nothing the user's next move is
    // usually to retake the same panel from closer up.
  };

  return (
    <section className={`package-scan ${primary ? 'package-scan--primary' : ''}`}>
      <h3 className="package-scan__title">
        <span aria-hidden="true">📷</span> {hasPreviousScan ? 'צילום נוסף של האריזה' : 'צילום סימון האלרגנים'}
      </h3>
      <p className="package-scan__instructions">
        צלמו את רשימת הרכיבים וסימון האלרגנים בצורה ברורה, מקרוב ובאור טוב.
      </p>

      <input
        ref={cameraInputRef}
        className="package-scan__file"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => pick(event.target.files?.[0])}
      />
      <input
        ref={galleryInputRef}
        className="package-scan__file"
        type="file"
        accept="image/*"
        onChange={(event) => pick(event.target.files?.[0])}
      />

      <div className="package-scan__actions">
        <button
          type="button"
          className={`button ${primary ? 'button--primary button--large' : 'button--secondary'}`}
          disabled={analyzing}
          onClick={() => cameraInputRef.current?.click()}
        >
          📷 צלם את סימון האלרגנים
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={analyzing}
          onClick={() => galleryInputRef.current?.click()}
        >
          בחירת תמונה מהגלריה
        </button>
      </div>

      {selection && (
        <div className="package-scan__preview">
          <img src={selection.url} alt="תצוגה מקדימה של התמונה שנבחרה" />
          <div className="package-scan__preview-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={analyzing}
              onClick={() => void runAnalysis()}
            >
              נתח תמונה
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={analyzing}
              onClick={() => setSelection(null)}
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {analyzing && (
        <div className="package-scan__progress" aria-live="polite">
          <div className="loading__spinner" aria-hidden="true" />
          <p>בודק את סימון האלרגנים…</p>
          <progress max={1} value={packageScan.progress} />
          <p className="package-scan__note">
            הבדיקה מתבצעת במכשיר שלכם. התמונה אינה נשלחת לשום שרת.
          </p>
        </div>
      )}

      {packageScan.error && (
        <p className="package-scan__error" role="alert">
          {packageScan.error.userMessage}
        </p>
      )}
    </section>
  );
}
