import { useState, type FormEvent } from 'react';

import { validateBarcode } from '../../utils/barcode.ts';

interface ManualBarcodeInputProps {
  readonly onSubmit: (barcode: string) => void;
  readonly onCancel: () => void;
  readonly disabled?: boolean;
}

/** Fallback entry path: damaged barcode, no camera, desktop, developer testing. */
export function ManualBarcodeInput({ onSubmit, onCancel, disabled }: ManualBarcodeInputProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateBarcode(value);
    if (!validation.valid) {
      setError(
        value.replace(/\D+/g, '').length === 0
          ? 'יש להזין את מספר הברקוד.'
          : 'הברקוד אינו תקין. יש להזין 8, 12 או 13 ספרות בדיוק כפי שמופיעות על האריזה.',
      );
      return;
    }
    setError(null);
    onSubmit(validation.barcode);
  };

  return (
    <form className="manual-form" onSubmit={handleSubmit}>
      <label className="manual-form__label" htmlFor="manual-barcode">
        הזנת ברקוד ידנית
      </label>
      <input
        id="manual-barcode"
        className="manual-form__input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="7290000066318"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-invalid={error !== null}
        aria-describedby={error ? 'manual-barcode-error' : undefined}
      />
      {error && (
        <p className="manual-form__error" id="manual-barcode-error" role="alert">
          {error}
        </p>
      )}
      <div className="manual-form__actions">
        <button type="submit" className="button button--primary" disabled={disabled}>
          בדיקת המוצר
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </form>
  );
}
