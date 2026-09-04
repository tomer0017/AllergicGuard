import type { ProductLookupResult } from '../../services/product-data/productLookupService.ts';
import { SourceTransparency } from './SourceTransparency.tsx';
import { describeEvidenceKind, presentAssessment } from './resultMessages.ts';

interface ResultScreenProps {
  readonly result: ProductLookupResult;
  readonly onScanAgain: () => void;
}

/**
 * Renders a decision that was already made by the domain layer.
 * This component contains no allergy logic whatsoever.
 */
export function ResultScreen({ result, onScanAgain }: ResultScreenProps) {
  const presentation = presentAssessment(result.assessment);
  const product = result.product;
  const productTitle = product?.displayName ?? 'מוצר לא מזוהה';

  return (
    <div className={`result result--${presentation.tone}`}>
      <section className="result__banner" role="alert" aria-live="assertive">
        <span className="result__icon" aria-hidden="true">
          {presentation.icon}
        </span>
        <h2 className="result__headline">{presentation.headline}</h2>
        <p className="result__explanation">{presentation.explanation}</p>
        <p className="result__action">{presentation.action}</p>
        {presentation.disclaimer && <p className="result__disclaimer">{presentation.disclaimer}</p>}
      </section>

      {result.inputError && (
        <p className="result__notice" role="alert">
          {result.inputError.userMessage}
        </p>
      )}

      {result.assessment.hasConflict && (
        <p className="result__notice">שימו לב: נמצאו הבדלים בין מקורות המידע. התוצאה המחמירה היא שמוצגת.</p>
      )}

      <section className="result__product">
        <div className="result__product-text">
          <h3 className="result__product-name">{productTitle}</h3>
          {product?.brand && <p className="result__product-brand">{product.brand}</p>}
          {product?.quantity && <p className="result__product-meta">{product.quantity}</p>}
          <p className="result__product-meta">ברקוד: {result.barcode}</p>
        </div>
        {product?.imageUrl && (
          <img className="result__product-image" src={product.imageUrl} alt="" loading="lazy" />
        )}
      </section>

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

      <button type="button" className="button button--primary button--large" onClick={onScanAgain}>
        סרוק מוצר נוסף
      </button>
    </div>
  );
}
