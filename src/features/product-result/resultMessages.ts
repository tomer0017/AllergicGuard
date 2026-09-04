/**
 * The ONLY place that turns a domain assessment into Hebrew user-facing text.
 *
 * Wording rules (safety-critical):
 *  - The green state never says "בטוח" / "safe". It says only that no peanut
 *    indication was found in the available information.
 *  - Every state tells the user what to DO.
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

const REASON_TEXT: Record<AssessmentReasonCode, string> = {
  CONTAINS_DECLARED: 'המוצר מסומן כמכיל בוטנים.',
  MAY_CONTAIN_DECLARED: 'המוצר מסומן כעלול להכיל בוטנים או עקבות בוטנים.',
  ALLERGEN_FOUND_IN_TEXT: 'נמצא אזכור של בוטנים ברשימת הרכיבים או באזהרות של המוצר.',

  NO_SOURCES_RESPONDED: 'לא הצלחנו לקבל מידע אמין על המוצר.',
  PRODUCT_NOT_FOUND: 'המוצר לא נמצא במאגרי המידע.',
  NO_ALLERGEN_CAPABLE_SOURCE: 'המקורות שנמצאו מזהים את המוצר בלבד ואינם כוללים מידע על אלרגנים.',
  ALLERGEN_DATA_MISSING: 'לא נמצא מידע מלא על אלרגנים.',
  MAY_CONTAIN_DATA_MISSING: 'לא נמצא מידע לגבי "עלול להכיל" או עקבות.',
  ALLERGEN_DATA_INSUBSTANTIAL: 'המקור החזיר רשומת אלרגנים ריקה, ולא ניתן להבדיל בינה לבין מידע שלא הוזן.',
  SOURCE_RELIABILITY_TOO_LOW: 'המידע שנמצא אינו אמין מספיק כדי להסתמך עליו.',
  PRODUCT_IDENTITY_CONFLICT: 'נמצא מידע סותר בין מקורות לגבי זהות המוצר.',

  NO_INDICATION_IN_COMPLETE_DATA: 'במידע הזמין נמצא סימון אלרגנים מלא, ובוטנים אינם מופיעים בו.',
};

const GREEN_DISCLAIMER =
  'זו אינה הצהרה שהמוצר בטוח. במקרה של אלרגיה מסכנת חיים יש לבדוק גם את סימון האלרגנים שעל האריזה.';

export function presentAssessment(assessment: AllergyAssessment): ResultPresentation {
  const explanation = REASON_TEXT[assessment.reasonCode];

  switch (assessment.status) {
    case 'danger':
      return {
        tone: 'red',
        icon: '⛔',
        headline: 'נמצא סיכון לבוטנים',
        explanation,
        action: 'אין לתת את המוצר לילד.',
      };
    case 'insufficient_data':
      return {
        tone: 'orange',
        icon: '⚠️',
        headline: 'אין מספיק מידע — חייבים לבדוק',
        explanation,
        action: 'אין להניח שהמוצר בטוח. יש לבדוק את סימון האלרגנים שעל האריזה.',
      };
    case 'no_known_risk':
      return {
        tone: 'green',
        icon: '✅',
        headline: 'לא נמצא סימון לבוטנים במידע הזמין',
        explanation,
        action: 'יש לוודא את הסימון על האריזה לפני הגשה.',
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
