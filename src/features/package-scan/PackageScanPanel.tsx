import { useEffect, useRef, useState } from 'react';
import { Camera, Images, RefreshCw } from 'lucide-react';

import type { PackageScanApi, RetakeRequest } from '../../app/useProductScan.ts';
import type { AssessmentStatus } from '../../domain/allergy/assessment.ts';

interface PackageScanPanelProps {
  readonly packageScan: PackageScanApi;
  /** Drives how much weight the action carries. */
  readonly status: AssessmentStatus;
}

/** Retake guidance, phrased as what to DO rather than what went wrong. */
const RETAKE_TEXT: Record<RetakeRequest['reason'], { title: string; body: string }> = {
  poor_quality: {
    title: 'לא הצלחנו לקרוא את הסימון בצורה ברורה.',
    body: 'צלמו שוב מקרוב את הרכיבים וסימון האלרגנים.',
  },
  partial_read: {
    title: 'קראנו רק חלק מהסימון.',
    body: 'צלמו שוב כך שכל אזור הרכיבים ייכנס לתמונה.',
  },
  analysis_failed: {
    title: 'הבדיקה לא הושלמה.',
    body: 'נסו לצלם שוב, או קראו את הסימון על האריזה.',
  },
};

const HINTS = ['מקרוב', 'ישר', 'באור טוב', 'ללא השתקפות'];

/**
 * Capture and analysis of the package label.
 *
 * Choosing a photo starts the analysis immediately — there is no "analyze"
 * step. The camera button is the primary action whenever the check is still
 * open; the gallery is a quiet peer beneath it, never a competing button.
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
  const retake = packageScan.retake;
  const firstAttempt = packageScan.attempts === 0;
  // GREEN is already answered; the photo stays available as a double-check but
  // must not shout louder than the verdict it would be re-testing.
  const emphasise = status !== 'no_known_risk';

  const pick = (file: File | undefined, input: HTMLInputElement | null) => {
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    // Reset the input so picking the SAME file again still fires a change event
    // — otherwise a retake of an identical shot would silently do nothing.
    if (input) input.value = '';
    void packageScan.analyze(file);
  };

  if (analyzing) {
    return (
      <section className="capture capture--busy" aria-live="polite">
        {previewUrl && <img className="capture__thumb" src={previewUrl} alt="" />}
        <div className="capture__busy-text">
          <span className="capture__spinner" aria-hidden="true" />
          <p>קורא את הרכיבים וסימון האלרגנים…</p>
          <div className="capture__bar" aria-hidden="true">
            <span style={{ width: `${Math.round(packageScan.progress * 100)}%` }} />
          </div>
          <p className="capture__note">הבדיקה מתבצעת במכשיר שלכם.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="capture">
      {retake ? (
        <div className="capture__retake" role="alert">
          <p className="capture__retake-title">{RETAKE_TEXT[retake.reason].title}</p>
          <p className="capture__retake-body">{RETAKE_TEXT[retake.reason].body}</p>
          <ul className="capture__hints">
            {HINTS.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : (
        emphasise && (
          <p className="capture__lead">
            {firstAttempt
              ? 'צלמו את הרכיבים וסימון האלרגנים כדי להשלים את הבדיקה.'
              : 'אפשר לצלם אזור נוסף של האריזה.'}
          </p>
        )
      )}

      <input
        ref={cameraInputRef}
        className="capture__file"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => pick(event.target.files?.[0], cameraInputRef.current)}
      />
      <input
        ref={galleryInputRef}
        className="capture__file"
        type="file"
        accept="image/*"
        onChange={(event) => pick(event.target.files?.[0], galleryInputRef.current)}
      />

      <button
        type="button"
        className={`btn ${emphasise || retake ? 'btn--primary btn--xl' : 'btn--quiet'}`}
        onClick={() => cameraInputRef.current?.click()}
      >
        {retake || !firstAttempt ? (
          <RefreshCw size={20} aria-hidden="true" />
        ) : (
          <Camera size={20} aria-hidden="true" />
        )}
        {retake || !firstAttempt ? 'צלם שוב' : 'צלם את גב האריזה'}
      </button>

      <button
        type="button"
        className="capture__gallery"
        onClick={() => galleryInputRef.current?.click()}
      >
        <Images size={16} aria-hidden="true" />
        יש לכם תמונה? בחירה מהגלריה
      </button>
    </section>
  );
}
