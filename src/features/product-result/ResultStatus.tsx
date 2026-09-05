import { AlertTriangle, CircleCheck, OctagonAlert } from 'lucide-react';

import type { AllergyAssessment } from '../../domain/allergy/assessment.ts';
import type { PackageScanRecord } from '../../services/product-data/productLookupService.ts';
import { presentAssessment, shortReason } from './resultMessages.ts';

interface ResultStatusProps {
  readonly assessment: AllergyAssessment;
  readonly scans: readonly PackageScanRecord[];
  /**
   * True for a photo-only check that has not analyzed anything yet. The domain
   * status is `insufficient_data` — correctly, since nothing has been checked —
   * but telling the user "we could not get information about the product" is
   * false: we have not looked yet, and there is no product to look up.
   */
  readonly awaitingFirstPhoto?: boolean;
}

/**
 * The verdict, rendered with an intensity that matches its meaning.
 *
 * This is the most important rule in the whole interface: the three states are
 * NOT one component in three colours.
 *
 *   RED    — a real, known risk. Loud on purpose: full-width danger block,
 *            large mark, the reason spelled out. Impossible to miss.
 *   ORANGE — "we do not know enough yet". A compact status line, no panel, no
 *            border, no drama. It is a step in a process, not an alarm, and
 *            the screen's weight belongs to the action that follows it.
 *   GREEN  — reassuring but never absolute. Calm, positive, with the caveat
 *            kept small rather than shouted.
 *
 * Making ORANGE look like RED taught users to ignore both.
 */
export function ResultStatus({ assessment, scans, awaitingFirstPhoto }: ResultStatusProps) {
  const presentation = presentAssessment(assessment, { packageScanCount: scans.length });

  // Nothing has been checked yet. This is a starting point, not a finding —
  // and it is never GREEN: the status underneath is still insufficient_data.
  if (awaitingFirstPhoto && assessment.status === 'insufficient_data') {
    return (
      <div className="status status--start" role="status">
        <p className="status__title">בדיקה לפי צילום האריזה</p>
        <p className="status__line">צלמו את הרכיבים וסימון האלרגנים כדי להתחיל.</p>
      </div>
    );
  }

  if (assessment.status === 'insufficient_data') {
    return (
      <div className="status status--unknown" role="status">
        <AlertTriangle className="status__glyph" size={20} aria-hidden="true" />
        <div className="status__text">
          <p className="status__title">אין מספיק מידע על המוצר</p>
          <p className="status__line">{presentation.explanation}</p>
        </div>
      </div>
    );
  }

  if (assessment.status === 'no_known_risk') {
    return (
      <div className="status status--ok" role="status">
        <CircleCheck className="status__glyph" size={22} aria-hidden="true" />
        <div className="status__text">
          <p className="status__title">{presentation.headline}</p>
          <p className="status__line">{presentation.action}</p>
          <p className="status__caveat">{presentation.disclaimer}</p>
        </div>
      </div>
    );
  }

  // ---- danger ----
  // The quoted wording, when it exists, comes verbatim from the package
  // evidence. Nothing here invents a reason the engine did not give.
  const escalating = scans.find((scan) => scan.escalated);
  const quoted = escalating?.packageEvidence.statements[0]?.text;
  const reason = shortReason(assessment);

  return (
    <div className="status status--danger" role="alert">
      <OctagonAlert className="status__glyph" size={34} strokeWidth={2.25} aria-hidden="true" />
      <p className="status__headline">נמצא סיכון לבוטנים</p>
      {/* One reason, not two. When the package itself is quoted, the quote IS
          the reason — repeating a generic label above it says nothing extra. */}
      {reason && !quoted && <p className="status__reason">{reason}</p>}
      {quoted && (
        <p className="status__quote">
          <span className="status__quote-source">על האריזה מופיע:</span>
          <q>{quoted}</q>
        </p>
      )}
      <p className="status__verdict">אין לתת את המוצר לילד.</p>
    </div>
  );
}
