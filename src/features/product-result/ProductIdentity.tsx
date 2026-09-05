import { Package } from 'lucide-react';

import type { ProductIdentity as Identity } from '../../domain/product/productIdentity.ts';

interface ProductIdentityProps {
  readonly product: Identity | null;
  readonly barcode: string;
  /** Compact variant for the result header; full variant for confirmation. */
  readonly size?: 'compact' | 'full';
}

/**
 * Who am I checking?
 *
 * The user is matching this against the package in their hand, so the image and
 * the name carry the weight. The 13-digit barcode is deliberately quiet — it is
 * a machine identifier, and it used to compete with the product name for
 * attention while helping nobody read it.
 */
export function ProductIdentity({ product, barcode, size = 'compact' }: ProductIdentityProps) {
  const name = product?.displayName ?? 'מוצר לא מזוהה';
  const meta = [product?.brand, product?.quantity].filter(Boolean).join(' · ');

  return (
    <div className={`identity identity--${size}`}>
      {product?.imageUrl ? (
        <img className="identity__image" src={product.imageUrl} alt="" loading="eager" />
      ) : (
        <span className="identity__image identity__image--empty" aria-hidden="true">
          <Package size={size === 'full' ? 34 : 26} strokeWidth={1.75} />
        </span>
      )}
      <div className="identity__text">
        <h2 className="identity__name">{name}</h2>
        {meta && <p className="identity__meta">{meta}</p>}
        {/* A barcode is Latin digits: forcing LTR stops RTL from reordering it. */}
        {barcode && (
          <p className="identity__barcode" dir="ltr">
            {barcode}
          </p>
        )}
      </div>
    </div>
  );
}
