/**
 * The ONLY place that turns a domain assessment into Hebrew user-facing text.
 *
 * Wording rules (safety-critical):
 *  - The green state never says "בטוח" / "safe". It says only that no peanut
 *    indication was found in the available information.
 *  - Every state tells the user what to DO.
 *
 * Copy rules (added in the UI redesign):
 *  - Say a thing ONCE. One status, one explanation, one action.
 *  - No system language. The user should never have to understand our
 *    architecture to know what to do next.
 */

import type { AllergyAssessment, AssessmentReasonCode } from '../../domain/allergy/assessment.ts';
import { assertNever } from '../../domain/allergy/assessment.ts';

export type ResultTone = 'red' | 'orange' | 'green';

export interface ResultPresentation {
  readonly tone: ResultTone;
  readonly icon: string;
  readonly headline: string;
  readonly explanation: string;
  readonly action: string;
  /** Shown under the green state only. */
  readonly disclaimer?: string;
}

/**
 * The one-line version, used as the headline detail on a RED screen.
 *
 * These restate the DOMAIN's reason code — they never add a claim the engine
 * did not make. The exact wording read from a package is quoted separately,
 * verbatim, from the package evidence itself.
 */
const SHORT_REASON: Partial<Record<AssessmentReasonCode, string>> = {
  CONTAINS_DECLARED: 'מכיל בוטנים',
  MAY_CONTAIN_DECLARED: 'עלול להכיל בוטנים',
  ALLERGEN_FOUND_IN_TEXT: 'בוטנים ברשימת הרכיבים',
  ALLERGEN_IN_PRODUCT_NAME: 'שם המוצר כולל בוטנים',
};

export function shortReason(assessment: AllergyAssessment): string | undefined {
  return SHORT_REASON[assessment.reasonCode];
}

const REASON_TEXT: Record<AssessmentReasonCode, string> = {
  CONTAINS_DECLARED: 'המוצר מסומן כמכיל בוטנים.',
  MAY_CONTAIN_DECLARED: 'המוצר מסומן כעלול להכיל בוטנים או עקבות בוטנים.',
  ALLERGEN_FOUND_IN_TEXT: 'נמצא אזכור של בוטנים ברשימת הרכיבים או באזהרות של המוצר.',
  ALLERGEN_IN_PRODUCT_NAME: 'שם המוצר עצמו כולל בוטנים.',

  NO_SOURCES_RESPONDED: 'לא הצלחנו לקבל מידע על המוצר.',
  PRODUCT_NOT_FOUND: 'המוצר לא נמצא במאגרי המידע.',
  NO_ALLERGEN_CAPABLE_SOURCE: 'המידע שנמצא כולל את שם המוצר בלבד.',
  ALLERGEN_DATA_MISSING: 'אין במאגרים מידע מלא על אלרגנים במוצר הזה.',
  MAY_CONTAIN_DATA_MISSING: 'חסר מידע על "עלול להכיל" ועקבות.',
  ALLERGEN_DATA_INSUBSTANTIAL: 'רשומת האלרגנים במאגר ריקה.',
  SOURCE_RELIABILITY_TOO_LOW: 'המידע שנמצא אינו אמין מספיק.',
  PRODUCT_IDENTITY_CONFLICT: 'נמצא מידע סותר לגבי זהות המוצר.',

  NO_INDICATION_IN_COMPLETE_DATA: 'במידע הזמין נמצא סימון אלרגנים מלא, ובוטנים אינם מופיעים בו.',
};

/** Never softened: GREEN is "no indication found", not "safe". */
const GREEN_DISCLAIMER =
  'זו אינה הצהרה שהמוצר בטוח. באלרגיה מסכנת חיים יש לבדוק תמיד גם את האריזה.';

export interface PresentationContext {
  /** How many package photos have already been folded into this result. */
  readonly packageScanCount?: number;
}

export function presentAssessment(
  assessment: AllergyAssessment,
  context: PresentationContext = {},
): ResultPresentation {
  const explanation = REASON_TEXT[assessment.reasonCode];
  const photographed = (context.packageScanCount ?? 0) > 0;

  switch (assessment.status) {
    case 'danger':
      return {
        tone: 'red',
        icon: '⛔',
        headline: 'נמצא סיכון לבוטנים',
        explanation,
        action: 'אין לתת את המוצר לילד.',
      };
    // ORANGE says the missing-data fact ONCE. The instruction and the button
    // carry everything else, so the screen has one status, one line, one action.
    case 'insufficient_data':
      return {
        tone: 'orange',
        icon: '⚠️',
        headline: 'אין מספיק מידע — חייבים לבדוק',
        // ORANGE is a data-coverage answer, not an application error. It says
        // what is missing and offers the photo as the next concrete step.
        explanation: photographed
          ? 'גם בצילום האריזה לא נמצא סימון ברור.'
          : explanation,
        action: photographed
          ? 'צלמו שוב מקרוב, או קראו את הסימון על האריזה.'
          : 'צלמו את הרכיבים וסימון האלרגנים כדי להשלים את הבדיקה.',
      };
    case 'no_known_risk':
      return {
        tone: 'green',
        icon: '✅',
        headline: 'לא נמצא סימון לבוטנים',
        explanation,
        action: 'מומלץ לוודא את הסימון על האריזה לפני הגשה.',
        disclaimer: GREEN_DISCLAIMER,
      };
    default:
      return assertNever(assessment, 'Unhandled assessment status');
  }
}

/** Hebrew label for a single piece of evidence shown in the transparency area. */
export function describeEvidenceKind(kind: string): string {
  switch (kind) {
    case 'contains_declared':
      return 'סימון "מכיל" מהמקור';
    case 'may_contain_declared':
      return 'סימון "עלול להכיל"/עקבות';
    case 'text_match':
      return 'אזכור בטקסט הרכיבים';
    case 'product_name_match':
      return 'בוטנים בשם המוצר';
    case 'no_indication':
      return 'לא נמצא סימון לבוטנים';
    case 'allergen_data_missing':
      return 'חסר מידע על אלרגנים';
    case 'allergen_data_insubstantial':
      return 'רשומת אלרגנים ריקה מהמקור';
    case 'may_contain_data_missing':
      return 'חסר מידע על "עלול להכיל"';
    case 'identity_only_source':
      return 'מקור לזיהוי מוצר בלבד';
    case 'source_unavailable':
      return 'המקור לא היה זמין';
    default:
      return kind;
  }
}
