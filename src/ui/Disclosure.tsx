import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

interface DisclosureProps {
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * Collapsed-by-default section for everything the user does not need in order
 * to act: sources, reliability, timestamps, evidence, diagnostics.
 *
 * Nothing is removed by putting it here — it is one tap away and fully
 * accessible. It simply stops competing with the verdict for attention.
 *
 * The chevron points left because the page is RTL: "forward" is leftward.
 */
export function Disclosure({ label, children }: DisclosureProps) {
  return (
    <details className="disclosure">
      <summary className="disclosure__summary">
        <span>{label}</span>
        <ChevronLeft className="disclosure__chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
