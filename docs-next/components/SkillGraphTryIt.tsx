'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';

// Client-side only — SkillGraphFlow uses xyflow, which touches the DOM.
const Inner = dynamic(() => import('./SkillGraphTryItInner'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        border: '1px solid var(--af-border, #2a2a32)',
        color: 'var(--af-fg-muted, #8c887e)',
        fontSize: 14,
      }}
    >
      Loading the skill graph…
    </div>
  ),
});

/**
 * `children` is the server-rendered <CodeFile region="demo"> of the demo file
 * (the real code, read at build time). We forward it into the client island as
 * `code` so the shown bytes are the same file the drawn graph is built from.
 * `demo` picks which single-source demo backs the embed — `'support'` (default,
 * skillGraphDemo.ts) or `'quickstart'` (skillGraphQuickstartDemo.ts).
 */
export function SkillGraphTryIt({
  children,
  demo,
}: {
  children?: ReactNode;
  demo?: 'support' | 'quickstart';
}) {
  return <Inner code={children} demo={demo} />;
}

export default SkillGraphTryIt;
