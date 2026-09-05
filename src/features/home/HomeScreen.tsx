import { Camera, Keyboard, ScanLine } from 'lucide-react';

import { BrandMark } from '../../ui/BrandMark.tsx';

interface HomeScreenProps {
  readonly onScan: () => void;
  readonly onManual: () => void;
  readonly onPackagePhoto: () => void;
  /** False when no package-analysis provider is enabled in this build. */
  readonly packagePhotoAvailable: boolean;
}

/**
 * The app home.
 *
 * There are exactly THREE ways to check a product and all three are visible
 * without scrolling. Barcode scanning is the primary path and gets the weight;
 * manual entry and package photo are peers below it.
 *
 * The package photo is a first-class entry point, not an ORANGE fallback — a
 * user abroad, or holding a product no database has ever heard of, should not
 * have to scan a barcode first to be allowed to use it.
 */
export function HomeScreen({
  onScan,
  onManual,
  onPackagePhoto,
  packagePhotoAvailable,
}: HomeScreenProps) {
  return (
    <div className="home">
      <div className="home__brand">
        <BrandMark variant="lockup" size={92} />
        <p className="home__tagline">בדיקת מוצר לאלרגנים</p>
        <p className="home__blurb">בדיקה מהירה של מידע על אלרגנים במוצרי מזון</p>
      </div>

      <button type="button" className="home__primary" onClick={onScan}>
        <span className="home__primary-icon" aria-hidden="true">
          <ScanLine size={30} strokeWidth={2} />
        </span>
        <span className="home__primary-text">
          <span className="home__primary-title">סריקת ברקוד</span>
          <span className="home__primary-sub">הדרך המהירה ביותר לבדוק מוצר</span>
        </span>
      </button>

      <div className="home__alternatives">
        {packagePhotoAvailable && (
          <button type="button" className="home__option" onClick={onPackagePhoto}>
            <span className="home__option-icon" aria-hidden="true">
              <Camera size={22} strokeWidth={2} />
            </span>
            <span className="home__option-text">
              <span className="home__option-title">צילום גב האריזה</span>
              {/* Deliberately "בכל שפה" and not a translation promise: the OCR
                  reads Hebrew and Latin script, it does not translate. */}
              <span className="home__option-sub">רכיבים וסימון אלרגנים · בכל שפה</span>
            </span>
          </button>
        )}

        <button type="button" className="home__option" onClick={onManual}>
          <span className="home__option-icon" aria-hidden="true">
            <Keyboard size={22} strokeWidth={2} />
          </span>
          <span className="home__option-text">
            <span className="home__option-title">הזנת ברקוד ידנית</span>
            <span className="home__option-sub">הקלידו את המספר שמתחת לברקוד</span>
          </span>
        </button>
      </div>
    </div>
  );
}
