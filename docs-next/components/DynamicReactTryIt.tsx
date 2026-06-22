'use client';

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

export function DynamicReactTryIt() {
  return <Inner />;
}

export default DynamicReactTryIt;
