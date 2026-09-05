import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

interface BrandMarkProps {
  /** Rendered size in px. Kept small: the logo identifies, it does not decorate. */
  readonly size?: number;
  /**
   * `lockup` is the shield plus the AllergicGuard wordmark — home screen only.
   * `mark` is the shield alone, for compact headers where a wordmark at 28px
   * would be unreadable anyway.
   */
  readonly variant?: 'lockup' | 'mark';
}

/**
 * The AllergicGuard logo.
 *
 * The artwork lives in `public/` and is loaded by URL rather than imported, so
 * replacing a file needs no code change and no rebuild config. `BASE_URL`
 * keeps it correct under the `/AllergicGuard/` GitHub Pages path.
 *
 * Both files are the supplied artwork — trimmed, cropped and resized, never
 * redrawn. Although the shield contains a peanut, the surrounding UI stays
 * allergen-agnostic so the product can add allergens without a rebrand.
 *
 * If the file is missing the component falls back to a neutral shield rather
 * than an approximation of the brand: a wrong logo is worse than no logo, and
 * the fallback is deliberately allergen-agnostic so the app never looks like a
 * peanut-only product.
 */
export function BrandMark({ size = 36, variant = 'mark' }: BrandMarkProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="brandmark brandmark--fallback" style={{ width: size, height: size }}>
        <ShieldCheck size={Math.round(size * 0.72)} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }

  // The lockup is wider than it is tall; only its height is constrained.
  return (
    <img
      className={`brandmark brandmark--${variant}`}
      src={`${import.meta.env.BASE_URL}${variant === 'lockup' ? 'logo.png' : 'logo-mark.png'}`}
      height={size}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
