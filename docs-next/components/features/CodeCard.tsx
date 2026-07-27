import type { ReactNode } from 'react';

/**
 * The dark code card used by the BUILD and SWAP stages (and the closing install line).
 *
 * Deliberately dark in BOTH site themes — a terminal/editor surface reads as "this is code"
 * regardless of the page around it, and it's the one element of the design that is the same
 * in light and dark. Colours are page-scoped `--aff-code-*` vars (features.css).
 *
 * The snippets inside are DISPLAY strings, not compiled code, so their truth is guarded by
 * hand-verification against src/ — see each stage's header comment for the source lines.
 */
export function CodeCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`aff-code ${className}`.trim()}>{children}</div>;
}

/** One code line. `i` = indent level (1 = two spaces, 2 = four). */
export function Ln({
  children,
  i,
  className = '',
}: {
  children: ReactNode;
  i?: 1 | 2;
  className?: string;
}) {
  return <div className={`aff-ln${i ? ` i${i}` : ''} ${className}`.trim()}>{children}</div>;
}

/** Blinking block caret — parked at the end of the last line that has arrived. */
export function Caret() {
  return <span className="aff-caret" aria-hidden="true" />;
}

/** keyword / punctuation grey */
export function K({ children }: { children: ReactNode }) {
  return <span className="k">{children}</span>;
}

/** string literal green */
export function S({ children }: { children: ReactNode }) {
  return <span className="s">{children}</span>;
}
