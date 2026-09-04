import type { ImageQuality, PackageStatementKind } from '../../domain/package/packageEvidence.ts';
import type { PackageScanRecord } from '../../services/product-data/productLookupService.ts';

interface PackageScanFindingsProps {
  readonly scans: readonly PackageScanRecord[];
}

const QUALITY_HEBREW: Record<ImageQuality, string> = {
  good: 'טובה',
  partial: 'חלקית',
  poor: 'ירודה',
};

const STATEMENT_HEBREW: Record<PackageStatementKind, string> = {
  contains: 'סימון "מכיל" / רשימת רכיבים',
  may_contain: 'סימון "עלול להכיל" / עקבות',
  product_name: 'שם המוצר על חזית האריזה',
  mention: 'אזכור של בוטנים על האריזה',
};

/**
 * Says out loud that a finding came from a photograph and not from a
 * manufacturer database, and quotes the exact text that was read — the user
 * has the package in hand and can verify the quote in a second.
 */
export function PackageScanFindings({ scans }: PackageScanFindingsProps) {
  if (scans.length === 0) return null;

  return (
    <section className="package-findings">
      {scans.map((scan, index) => {
        const evidence = scan.packageEvidence;
        return (
          <div
            className={`package-findings__card ${scan.escalated ? 'package-findings__card--alert' : ''}`}
            key={scan.scanId}
          >
            <h3 className="package-findings__title">
              צילום האריזה {scans.length > 1 ? `#${index + 1}` : ''}
            </h3>

            {scan.escalated && (
              <p className="package-findings__source" role="alert">
                <strong>מקור הסיכון: צילום האריזה</strong>
              </p>
            )}

            {evidence.statements.length > 0 ? (
              <ul className="package-findings__list">
                {evidence.statements.map((statement, statementIndex) => (
                  <li key={`${scan.scanId}-${statementIndex}`}>
                    <span className="package-findings__kind">{STATEMENT_HEBREW[statement.kind]}</span>
                    <span className="package-findings__quote">נמצא בצילום האריזה: “{statement.text}”</span>
                    {statement.viaOcrCorrection && (
                      <span className="package-findings__hint">
                        (הטקסט זוהה לאחר תיקון שגיאת קריאה — יש לוודא מול האריזה)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="package-findings__none">
                לא נמצא אזכור של בוטנים בצילום. <strong>אין בכך כדי להעיד שהמוצר נקי מבוטנים</strong> —
                ייתכן שהסימון לא נכלל בתמונה או לא נקרא במלואו.
              </p>
            )}

            {evidence.imageQuality === 'poor' && (
              <p className="package-findings__warning">
                לא הצלחנו לקרוא את הסימון בצורה ברורה. נסו לצלם שוב מקרוב ובאור טוב.
              </p>
            )}
            {evidence.imageQuality === 'partial' && (
              <p className="package-findings__warning">
                רק חלק מהסימון נקרא בבירור. מומלץ לצלם שוב מקרוב.
              </p>
            )}

            <dl className="package-findings__meta">
              <dt>מקור</dt>
              <dd>צילום האריזה</dd>
              <dt>שיטת ניתוח</dt>
              <dd>{evidence.analysisMethod}</dd>
              <dt>איכות קריאה</dt>
              <dd>{QUALITY_HEBREW[evidence.imageQuality]}</dd>
              <dt>ניסיון</dt>
              <dd>{index + 1}</dd>
            </dl>
          </div>
        );
      })}
    </section>
  );
}
