import { Check, X } from 'lucide-react';

import type { ProductLookupResult } from '../../services/product-data/productLookupService.ts';
import { ProductIdentity } from '../product-result/ProductIdentity.tsx';

interface ProductConfirmationProps {
  readonly result: ProductLookupResult;
  readonly onConfirm: () => void;
  readonly onReject: () => void;
}

/**
 * "Is this the product you scanned?" — presented as a native-feeling sheet.
 *
 * SAFETY NOTE: confirming here approves the BARCODE ↔ PACKAGE match and nothing
 * else. It is not an approval that the product is safe, and it never influences
 * the allergen verdict — which has already been computed and is shown only
 * after this step. Saying "no" discards the lookup entirely, because allergen
 * data for the wrong product is worse than no data at all.
 *
 * Nothing is persisted: the answer lives in component state for this session.
 */
export function ProductConfirmation({ result, onConfirm, onReject }: ProductConfirmationProps) {
  const identified = Boolean(result.product?.displayName);

  return (
    <section className="sheet" aria-labelledby="confirm-question">
      <ProductIdentity product={result.product} barcode={result.barcode} size="full" />

      <div className="sheet__ask">
        <h2 className="sheet__question" id="confirm-question">
          {identified ? 'האם זה המוצר שסרקת?' : 'האם זה הברקוד שעל המוצר?'}
        </h2>
        {!identified && (
          <p className="sheet__hint">לא מצאנו את המוצר במאגרים. השוו את הספרות לאריזה.</p>
        )}
      </div>

      <div className="sheet__actions">
        <button type="button" className="btn btn--primary btn--xl" onClick={onConfirm}>
          <Check size={20} aria-hidden="true" />
          {identified ? 'כן, זה המוצר' : 'כן, זה הברקוד'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onReject}>
          <X size={18} aria-hidden="true" />
          לא — סרוק שוב
        </button>
      </div>
    </section>
  );
}
