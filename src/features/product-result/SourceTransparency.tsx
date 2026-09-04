import {
  ALLERGEN_DATA_STATUS_HEBREW,
  RELIABILITY_HEBREW,
  SOURCE_TYPE_HEBREW,
  type ProductEvidence,
} from '../../domain/product/productEvidence.ts';
import type { ProviderResultRecord } from '../../services/product-data/productLookupService.ts';

interface SourceTransparencyProps {
  readonly evidence: readonly ProductEvidence[];
  readonly providerResults: readonly ProviderResultRecord[];
}

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('he-IL');
}

/**
 * Answers "where did this answer come from?" — source, source type, reliability,
 * and which information was and was not available. No confidence percentages:
 * the MVP has no scientifically justified way to compute one.
 */
export function SourceTransparency({ evidence, providerResults }: SourceTransparencyProps) {
  const failed = providerResults.filter((result) => result.status !== 'success');

  return (
    <details className="sources">
      <summary className="sources__summary">מאיפה הגיע המידע?</summary>

      {evidence.length === 0 && <p className="sources__empty">אף מקור מידע לא החזיר מידע על המוצר.</p>}

      {evidence.map((item, index) => {
        const updated = formatDate(item.lastUpdated);
        return (
          // A product can carry several package-scan entries from the same
          // provider, so the index is part of the key.
          <div className="sources__card" key={`${item.providerId}-${index}`}>
            <dl className="sources__list">
              <dt>מקור</dt>
              <dd>{item.providerName}</dd>
              <dt>סוג מקור</dt>
              <dd>{SOURCE_TYPE_HEBREW[item.sourceType]}</dd>
              <dt>רמת אמינות</dt>
              <dd>{RELIABILITY_HEBREW[item.reliability]}</dd>
              {updated && (
                <>
                  <dt>עודכן</dt>
                  <dd>{updated}</dd>
                </>
              )}
            </dl>

            <p className="sources__subtitle">מידע שנמצא:</p>
            <ul className="sources__fields">
              <li className={item.ingredientsText ? 'is-present' : 'is-missing'}>
                {item.ingredientsText ? '✓' : '✗'} רכיבים
              </li>
              <li className={item.allergenDataStatus === 'reported' ? 'is-present' : 'is-missing'}>
                {item.allergenDataStatus === 'reported' ? '✓' : '✗'} אלרגנים (
                {ALLERGEN_DATA_STATUS_HEBREW[item.allergenDataStatus]})
              </li>
              <li className={item.mayContainDataStatus === 'reported' ? 'is-present' : 'is-missing'}>
                {item.mayContainDataStatus === 'reported' ? '✓' : '✗'} מידע על "עלול להכיל" (
                {ALLERGEN_DATA_STATUS_HEBREW[item.mayContainDataStatus]})
              </li>
            </ul>

            {item.containsAllergens.length > 0 && (
              <p className="sources__line">
                <strong>מכיל:</strong> {item.containsAllergens.join(', ')}
              </p>
            )}
            {item.mayContainAllergens.length > 0 && (
              <p className="sources__line">
                <strong>עלול להכיל:</strong> {item.mayContainAllergens.join(', ')}
              </p>
            )}
            {item.sourceUrl && (
              <a className="sources__link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                צפייה במקור
              </a>
            )}
          </div>
        );
      })}

      {failed.length > 0 && (
        <div className="sources__card sources__card--muted">
          <p className="sources__subtitle">מקורות שלא סיפקו מידע:</p>
          <ul className="sources__fields">
            {failed.map((result) => (
              <li className="is-missing" key={result.providerId}>
                ✗ {result.providerName} — {result.status === 'not_found' ? 'המוצר לא נמצא' : 'שגיאה בפנייה למקור'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
