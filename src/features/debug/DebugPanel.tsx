import { useState } from 'react';

import type { LogEntry } from '../../infrastructure/logging/logger.ts';
import type { ProductLookupResult } from '../../services/product-data/productLookupService.ts';

interface DebugPanelProps {
  readonly result: ProductLookupResult | null;
  readonly logs: readonly LogEntry[];
}

/**
 * Development-only inspector. It is rendered by App only when
 * appConfig.debugPanelEnabled is true, which requires import.meta.env.DEV,
 * so it cannot reach a production bundle.
 */
export function DebugPanel({ result, logs }: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="debug">
      <button type="button" className="debug__toggle" onClick={() => setOpen((value) => !value)}>
        {open ? 'סגירת פאנל פיתוח' : 'פאנל פיתוח (DEV)'}
      </button>

      {open && (
        <div className="debug__body">
          {!result && <p className="debug__empty">עדיין לא בוצעה סריקה.</p>}

          {result && (
            <>
              <h4>Request</h4>
              <p>
                requestId: <code>{result.requestId}</code> · barcode: <code>{result.barcode}</code> ·
                allergen: <code>{result.allergen}</code>
              </p>

              <h4>Decision</h4>
              <p>
                status: <code>{result.assessment.status}</code> · reasonCode:{' '}
                <code>{result.assessment.reasonCode}</code>
              </p>
              <p>{result.assessment.reason}</p>

              <h4>Providers</h4>
              <table className="debug__table">
                <thead>
                  <tr>
                    <th>provider</th>
                    <th>status</th>
                    <th>http</th>
                    <th>ms</th>
                    <th>cache</th>
                  </tr>
                </thead>
                <tbody>
                  {result.providerResults.map((record) => (
                    <tr key={record.providerId}>
                      <td>{record.providerId}</td>
                      <td>{record.status}</td>
                      <td>{record.diagnostics.httpStatus ?? '—'}</td>
                      <td>{record.diagnostics.durationMs}</td>
                      <td>{record.fromCache ? 'hit' : 'miss'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4>Fields present / missing</h4>
              {result.providerResults.map((record) => (
                <p key={record.providerId}>
                  <strong>{record.providerId}</strong>
                  <br />
                  present: <code>{record.diagnostics.fieldsPresent.join(', ') || '—'}</code>
                  <br />
                  missing: <code>{record.diagnostics.fieldsMissing.join(', ') || '—'}</code>
                </p>
              ))}

              <h4>Package scans ({result.packageScans?.length ?? 0})</h4>
              {(result.packageScans ?? []).length === 0 && <p>no package photo analyzed</p>}
              {(result.packageScans ?? []).map((scan) => (
                <div key={scan.scanId}>
                  <p>
                    provider: <code>{scan.providerId}</code> · method:{' '}
                    <code>{scan.analysisMethod}</code> · duration:{' '}
                    <code>{scan.packageEvidence.durationMs}ms</code>
                  </p>
                  <p>
                    image quality: <code>{scan.packageEvidence.imageQuality}</code> · text length:{' '}
                    <code>{scan.packageEvidence.extractedText.length}</code>
                  </p>
                  <p>
                    quality metrics (NOT a safety score):{' '}
                    <code>{JSON.stringify(scan.packageEvidence.confidenceMetadata ?? {})}</code>
                  </p>
                  <p>
                    detected terms:{' '}
                    <code>{scan.packageEvidence.detectedPeanutTerms.join(', ') || '—'}</code>
                  </p>
                  <p>
                    contains evidence:{' '}
                    <code>{scan.packageEvidence.containsAllergens.join(' | ') || '—'}</code>
                  </p>
                  <p>
                    may-contain evidence:{' '}
                    <code>{scan.packageEvidence.mayContainAllergens.join(' | ') || '—'}</code>
                  </p>
                  <p>
                    warnings: <code>{scan.packageEvidence.warnings.join(' | ') || '—'}</code>
                  </p>
                  <p>
                    previous: <code>{scan.previousStatus}</code> /{' '}
                    <code>{scan.previousReasonCode}</code> → merged:{' '}
                    <code>{scan.newStatus}</code> / <code>{scan.newReasonCode}</code> · escalated:{' '}
                    <code>{String(scan.escalated)}</code>
                  </p>
                  <p>Extracted text</p>
                  <pre className="debug__pre">{scan.packageEvidence.extractedText || '(none)'}</pre>
                </div>
              ))}

              <h4>Evidence</h4>
              <pre className="debug__pre">{JSON.stringify(result.evidence, null, 2)}</pre>

              <h4>Conflicts</h4>
              <pre className="debug__pre">
                {result.conflicts.length > 0 ? JSON.stringify(result.conflicts, null, 2) : 'none'}
              </pre>

              <h4>Assessment evidence</h4>
              <pre className="debug__pre">{JSON.stringify(result.assessment.evidence, null, 2)}</pre>
            </>
          )}

          <h4>Log ({logs.length})</h4>
          <pre className="debug__pre">
            {logs
              .map(
                (entry) =>
                  `[${entry.stage}]${entry.context?.requestId ? `[${entry.context.requestId}]` : ''}${
                    entry.context?.providerId ? `[${entry.context.providerId}]` : ''
                  } ${entry.level.toUpperCase()} ${entry.message}`,
              )
              .join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
