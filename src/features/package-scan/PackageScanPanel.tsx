import { useEffect, useRef, useState } from 'react';

import type { PackageScanApi, RetakeRequest } from '../../app/useProductScan.ts';
import type { AssessmentStatus } from '../../domain/allergy/assessment.ts';

interface PackageScanPanelProps {
  readonly packageScan: PackageScanApi;
  /** Drives how prominent the call to action is. */
  readonly status: AssessmentStatus;
}

/** Retake guidance, phrased as what to DO rather than what went wrong. */
const RETAKE_TEXT: Record<RetakeRequest['reason'], { title: string; body: string }> = {
  poor_quality: {
    title: 'לא הצלחנו לקרוא את סימון האלרגנים בצורה ברורה.',
    body: 'צלמו שוב מקרוב כך שרשימת הרכיבים וסימון האלרגנים ימלאו את רוב התמונה.',
  },
  partial_read: {
    title: 'קראנו רק חלק מהסימון.',
    body: 'ייתכן שחלק מהטקסט לא נכנס לתמונה או לא נקרא. צלמו שוב מקרוב.',
  },
  analysis_failed: {
    title: 'ניתוח התמונה לא הושלם.',
    body: 'נסו לצלם שוב, או בדקו את סימון האלרגנים ידנית על האריזה.',
  },
};

const HINTS = ['מקרוב', 'ישר מול האריזה', 'באור טוב', 'ללא השתקפות', 'כל אזור הרכיבים בתמונה'];

/**
 * Camera / gallery capture for the allergen label.
 *
 * Choosing a photo starts the analysis immediately — there is no second
 * "analyze" tap. The preview stays on screen during processing so the user can
 * see what was sent, and a photo we could not read asks for a retake rather
 * than quietly reporting that nothing was found.
 */
export function PackageScanPanel({ packageScan, status }: PackageScanPanelProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // The effect owns revocation: it releases the previous URL when the pick
  // changes and the last one when the panel unmounts.
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  if (!packageScan.available) return null;

  const analyzing = packageScan.state === 'analyzing';
  const primary = status === 'insufficient_data';
  const retake = packageScan.retake;
  const firstAttempt = packageScan.attempts === 0;

  const pick = (file: File | undefined, input: HTMLInputElement | null) => {
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    // Reset the input so picking the SAME file again still fires a change event
    // — otherwise a retake of an identical shot would silently do nothing.
    if (input) input.value = '';
    void packageScan.analyze(file);
  };

  const ctaLabel = firstAttempt ? '📷 צלם את סימון האלרגנים' : '📷 צלם שוב';

  return (
    <section className={`package-scan ${primary ? 'package-scan--primary' : ''}`}>
      {retake ? (
        <div className="package-scan__retake" role="alert">
          <p className="package-scan__retake-title">{RETAKE_TEXT[retake.reason].title}</p>
          <p className="package-scan__retake-body">
            {retake.error?.userMessage ?? RETAKE_TEXT[retake.reason].body}
          </p>
          <ul className="package-scan__hints">
            {HINTS.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <h3 className="package-scan__title">
            <span aria-hidden="true">📷</span>{' '}
            {firstAttempt ? 'צילום סימון האלרגנים' : 'צילום נוסף של האריזה'}
          </h3>
          <p className="package-scan__instructions">
            צלמו את רשימת הרכיבים וסימון האלרגנים מקרוב, ישר מול האריזה ובאור טוב.
          </p>
        </>
      )}

      <input
        ref={cameraInputRef}
        className="package-scan__file"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => pick(event.target.files?.[0], cameraInputRef.current)}
      />
      <input
        ref={galleryInputRef}
        className="package-scan__file"
        type="file"
        accept="image/*"
        onChange={(event) => pick(event.target.files?.[0], galleryInputRef.current)}
      />

      {analyzing ? (
        <div className="package-scan__progress" aria-live="polite">
          {previewUrl && <img className="package-scan__thumb" src={previewUrl} alt="" />}
          <div className="loading__spinner" aria-hidden="true" />
          <p>קורא את סימון האלרגנים…</p>
          <progress max={1} value={packageScan.progress} />
          <p className="package-scan__note">
            הבדיקה מתבצעת במכשיר שלכם. התמונה אינה נשלחת לשום שרת.
          </p>
        </div>
      ) : (
        <div className="package-scan__actions">
          <button
            type="button"
            className={`button ${primary || retake ? 'button--primary button--large' : 'button--secondary'}`}
            onClick={() => cameraInputRef.current?.click()}
          >
            {ctaLabel}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => galleryInputRef.current?.click()}
          >
            בחירת תמונה מהגלריה
          </button>
        </div>
      )}
    </section>
  );
}
