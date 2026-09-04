/**
 * Centralized application error model.
 *
 * Every failure in the system is converted into an AppError so that:
 *  - the UI never sees raw exceptions or stack traces,
 *  - every failure carries a Hebrew message a kindergarten employee can read,
 *  - failures can be attributed to a specific provider.
 */

export type AppErrorCode =
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_NOT_AVAILABLE'
  | 'BARCODE_DECODE_FAILED'
  | 'INVALID_BARCODE'
  | 'NETWORK_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_HTTP_ERROR'
  | 'PRODUCT_NOT_FOUND'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_NOT_IMPLEMENTED'
  | 'ALLERGEN_DATA_MISSING'
  | 'UNKNOWN_ERROR';

export interface AppError {
  readonly code: AppErrorCode;
  /** English, developer-facing. Safe to log. Never shown to end users. */
  readonly technicalMessage: string;
  /** Hebrew, user-facing. Never contains stack traces or provider internals. */
  readonly userMessage: string;
  readonly providerId?: string;
  /** Original cause, kept for logging only. */
  readonly cause?: unknown;
}

const DEFAULT_USER_MESSAGES: Record<AppErrorCode, string> = {
  CAMERA_PERMISSION_DENIED: 'אין הרשאה לשימוש במצלמה. ניתן להזין את הברקוד ידנית.',
  CAMERA_NOT_AVAILABLE: 'לא נמצאה מצלמה זמינה. ניתן להזין את הברקוד ידנית.',
  BARCODE_DECODE_FAILED: 'לא הצלחנו לקרוא את הברקוד. נסו שוב או הזינו ידנית.',
  INVALID_BARCODE: 'הברקוד שהוזן אינו תקין.',
  NETWORK_ERROR: 'לא הצלחנו להתחבר לרשת. יש לבדוק את סימון האלרגנים על האריזה.',
  PROVIDER_TIMEOUT: 'החיפוש במאגר לקח יותר מדי זמן. יש לבדוק את סימון האלרגנים על האריזה.',
  PROVIDER_RATE_LIMIT: 'המאגר עמוס כרגע. יש לנסות שוב מאוחר יותר ולבדוק את האריזה.',
  PROVIDER_HTTP_ERROR: 'המאגר החזיר שגיאה. יש לבדוק את סימון האלרגנים על האריזה.',
  PRODUCT_NOT_FOUND: 'המוצר לא נמצא במאגרי המידע.',
  PROVIDER_INVALID_RESPONSE: 'התקבל מידע לא תקין מהמאגר. יש לבדוק את האריזה.',
  PROVIDER_DISABLED: 'מקור המידע אינו פעיל.',
  PROVIDER_NOT_IMPLEMENTED: 'מקור המידע עדיין אינו זמין.',
  ALLERGEN_DATA_MISSING: 'לא נמצא מידע על אלרגנים עבור המוצר.',
  UNKNOWN_ERROR: 'אירעה שגיאה בלתי צפויה. יש לבדוק את סימון האלרגנים על האריזה.',
};

export function createAppError(
  code: AppErrorCode,
  technicalMessage: string,
  options: { providerId?: string; cause?: unknown; userMessage?: string } = {},
): AppError {
  return {
    code,
    technicalMessage,
    userMessage: options.userMessage ?? DEFAULT_USER_MESSAGES[code],
    providerId: options.providerId,
    cause: options.cause,
  };
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'technicalMessage' in value &&
    'userMessage' in value
  );
}

/** Converts anything thrown into an AppError without ever losing the original cause. */
export function toAppError(error: unknown, providerId?: string): AppError {
  if (isAppError(error)) return error;
  if (error instanceof Error) {
    return createAppError('UNKNOWN_ERROR', `${error.name}: ${error.message}`, {
      providerId,
      cause: error,
    });
  }
  return createAppError('UNKNOWN_ERROR', `Non-error thrown: ${String(error)}`, {
    providerId,
    cause: error,
  });
}

/** Loggable projection of an AppError — never includes the raw cause object. */
export function describeAppError(error: AppError): Record<string, unknown> {
  return {
    code: error.code,
    message: error.technicalMessage,
    providerId: error.providerId,
  };
}
