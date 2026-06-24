'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';

// Load client-side only — the agent + lens touch the DOM (xyflow) and run live in
// the browser. Never server-render.
const Inner = dynamic(() => import('./DynamicReactTryItInner'), {
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
      Loading the live demo…
    </div>
  ),
});

/**
 * `children` is the server-rendered <CodeFile region="demo"> block from the MDX
 * page (the real builder source, read at build time). We forward it into the
 * client island as `code` so the shown bytes are the same file Run executes.
 */
export function DynamicReactTryIt({ children }: { children?: ReactNode }) {
  return <Inner code={children} />;
}

export default DynamicReactTryIt;
