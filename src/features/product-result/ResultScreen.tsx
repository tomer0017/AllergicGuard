import { ScanLine } from 'lucide-react';

import type { PackageScanApi } from '../../app/useProductScan.ts';
import { Disclosure } from '../../ui/Disclosure.tsx';
import { PackageScanPanel } from '../package-scan/PackageScanPanel.tsx';
import type { ProductLookupResult } from '../../services/product-data/productLookupService.ts';
import { PackageScanFindings } from './PackageScanFindings.tsx';
import { ProductIdentity } from './ProductIdentity.tsx';
import { ResultStatus } from './ResultStatus.tsx';
import { SourceTransparency } from './SourceTransparency.tsx';
import { describeEvidenceKind } from './resultMessages.ts';

interface ResultScreenProps {
  readonly result: ProductLookupResult;
  readonly packageScan: PackageScanApi;
  readonly onScanAgain: () => void;
}

/**
 * Renders a decision that was already made by the domain layer.
 * This component contains no allergy logic whatsoever.
 *
 * ORDER IS THE DESIGN. Three questions, answered top to bottom, once each:
 *   1. what product am I checking?   → ProductIdentity
 *   2. what did we conclude?         → ResultStatus
 *   3. what do I do now?             → PackageScanPanel / scan again
 *
 * Everything else — sources, reliability, timestamps, evidence, conflicts —
 * is one tap away inside a closed disclosure. Nothing was removed; it simply
 * stopped competing with the answer.
 */
export function ResultScreen({ result, packageScan, onScanAgain }: ResultScreenProps) {
  const scans = result.packageScans ?? [];
  const status = result.assessment.status;
  // RED is final: there is nothing a photo could add, and offering another step
  // would only dilute "do not give this to the child".
  const offerPackageScan = status !== 'danger';
  // A photo-only check has no barcode and no database identity to show.
  const photoOnly = result.barcode === '';
  const awaitingFirstPhoto = photoOnly && scans.length === 0;

  return (
    <div className={`result result--${status}`}>
      {!photoOnly && <ProductIdentity product={result.product} barcode={result.barcode} />}

      <ResultStatus
        assessment={result.assessment}
        scans={scans}
        awaitingFirstPhoto={awaitingFirstPhoto}
      />

      {offerPackageScan && <PackageScanPanel packageScan={packageScan} status={status} />}

      <button type="button" className="btn btn--quiet" onClick={onScanAgain}>
        <ScanLine size={18} aria-hidden="true" />
        בדיקת מוצר אחר
      </button>

      <Disclosure label="פרטי הבדיקה והמקורות">
        {result.inputError && (
          <p className="note note--alert" role="alert">
            {result.inputError.userMessage}
          </p>
        )}

        {result.assessment.hasConflict && (
          <p className="note">
            נמצאו הבדלים בין מקורות המידע. התוצאה המחמירה היא שמוצגת.
          </p>
        )}

        <PackageScanFindings scans={scans} />

        {result.assessment.evidence.length > 0 && (
          <ul className="evidence">
            {result.assessment.evidence.slice(0, 6).map((item, index) => (
              <li key={`${item.providerId}-${item.kind}-${index}`}>
                <span className="evidence__kind">{describeEvidenceKind(item.kind)}</span>
                <span className="evidence__provider">{item.providerName}</span>
              </li>
            ))}
          </ul>
        )}

        <SourceTransparency evidence={result.evidence} providerResults={result.providerResults} />
      </Disclosure>
    </div>
  );
}
