import type { PackageScanApi } from '../../app/useProductScan.ts';
import { PackageScanPanel } from '../package-scan/PackageScanPanel.tsx';
import type { ProductLookupResult } from '../../services/product-data/productLookupService.ts';
import { PackageScanFindings } from './PackageScanFindings.tsx';
import { SourceTransparency } from './SourceTransparency.tsx';
import { describeEvidenceKind, presentAssessment } from './resultMessages.ts';

interface ResultScreenProps {
  readonly result: ProductLookupResult;
  readonly packageScan: PackageScanApi;
  readonly onScanAgain: () => void;
}

/**
 * Renders a decision that was already made by the domain layer.
 * This component contains no allergy logic whatsoever.
 *
 * LAYOUT RULE (the user is kindergarten staff, often holding a child):
 * the first viewport carries identity, the verdict, and the one action to
 * take — in that order, and nothing else. Provider names, reliability grades,
 * timestamps, missing fields and diagnostics live below, collapsed. Nothing
 * technical may appear above the verdict.
 */
export function ResultScreen({ result, packageScan, onScanAgain }: ResultScreenProps) {
  const scans = result.packageScans ?? [];
  const presentation = presentAssessment(result.assessment, { packageScanCount: scans.length });
  const product = result.product;
  // RED is final: there is nothing a photo could add, and offering another step
  // would only dilute "do not give this to the child".
  const offerPackageScan = result.assessment.status !== 'danger';
  const escalatedByPhoto = scans.some((scan) => scan.escalated);

  return (
    <div className={`result result--${presentation.tone}`}>
      {/* ---- First viewport: who, what, and what to do. ---- */}
      <header className="result__identity">
        {product?.imageUrl ? (
          <img className="result__identity-image" src={product.imageUrl} alt="" loading="eager" />
        ) : (
          <div className="result__identity-image result__identity-image--placeholder" aria-hidden="true">
            📦
          </div>
        )}
        <div className="result__identity-text">
          <h2 className="result__identity-name">{product?.displayName ?? 'מוצר לא מזוהה'}</h2>
          {product?.brand && <p className="result__identity-brand">{product.brand}</p>}
          <p className="result__identity-barcode">{result.barcode}</p>
        </div>
      </header>

      <section className="result__banner" role="alert" aria-live="assertive">
        <span className="result__icon" aria-hidden="true">
          {presentation.icon}
        </span>
        <h2 className="result__headline">{presentation.headline}</h2>
        <p className="result__explanation">{presentation.explanation}</p>
        <p className="result__action">{presentation.action}</p>
        {escalatedByPhoto && (
          <p className="result__source-of-risk">מקור הסיכון: סימון על האריזה</p>
        )}
        {presentation.disclaimer && <p className="result__disclaimer">{presentation.disclaimer}</p>}
      </section>

      {offerPackageScan && (
        <PackageScanPanel packageScan={packageScan} status={result.assessment.status} />
      )}

      <button type="button" className="button button--secondary button--large" onClick={onScanAgain}>
        סרוק מוצר נוסף
      </button>

      {/* ---- Below the fold: everything technical, collapsed by default. ---- */}
      <details className="result__details">
        <summary className="result__details-summary">מידע נוסף</summary>

        {result.inputError && (
          <p className="result__notice" role="alert">
            {result.inputError.userMessage}
          </p>
        )}

        {result.assessment.hasConflict && (
          <p className="result__notice">
            שימו לב: נמצאו הבדלים בין מקורות המידע. התוצאה המחמירה היא שמוצגת.
          </p>
        )}

        <PackageScanFindings scans={scans} />

        {product?.quantity && <p className="result__product-meta">כמות: {product.quantity}</p>}

        {result.assessment.evidence.length > 0 && (
          <ul className="result__evidence">
            {result.assessment.evidence.slice(0, 6).map((item, index) => (
              <li key={`${item.providerId}-${item.kind}-${index}`}>
                <span className="result__evidence-kind">{describeEvidenceKind(item.kind)}</span>
                <span className="result__evidence-provider">{item.providerName}</span>
              </li>
            ))}
          </ul>
        )}

        <SourceTransparency evidence={result.evidence} providerResults={result.providerResults} />
      </details>
    </div>
  );
}
