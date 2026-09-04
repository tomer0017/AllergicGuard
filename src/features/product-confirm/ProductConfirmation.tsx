import type { ProductLookupResult } from '../../services/product-data/productLookupService.ts';

interface ProductConfirmationProps {
  readonly result: ProductLookupResult;
  readonly onConfirm: () => void;
  readonly onReject: () => void;
}

/**
 * "Is this the product you scanned?"
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
  const product = result.product;
  const identified = product !== null && Boolean(product.displayName);

  return (
    <section className="confirm" aria-labelledby="confirm-question">
      <div className="confirm__card">
        {product?.imageUrl ? (
          <img className="confirm__image" src={product.imageUrl} alt="" loading="eager" />
        ) : (
          <div className="confirm__image confirm__image--placeholder" aria-hidden="true">
            📦
          </div>
        )}

        <div className="confirm__text">
          <h2 className="confirm__name">{product?.displayName ?? 'מוצר לא מזוהה'}</h2>
          {product?.brand && <p className="confirm__brand">{product.brand}</p>}
          {product?.quantity && <p className="confirm__meta">{product.quantity}</p>}
          <p className="confirm__barcode">{result.barcode}</p>
        </div>
      </div>

      <h3 className="confirm__question" id="confirm-question">
        {identified ? 'האם זה המוצר שסרקת?' : 'האם זה הברקוד שמופיע על המוצר?'}
      </h3>
      {!identified && (
        <p className="confirm__hint">
          לא מצאנו את המוצר במאגרים. השוו את הספרות לברקוד שעל האריזה.
        </p>
      )}

      <div className="confirm__actions">
        <button type="button" className="button button--primary button--large" onClick={onConfirm}>
          {identified ? 'כן, זה המוצר' : 'כן, זה הברקוד'}
        </button>
        <button type="button" className="button button--secondary" onClick={onReject}>
          לא — סרוק שוב
        </button>
      </div>
    </section>
  );
}
