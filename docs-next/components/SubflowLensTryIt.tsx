'use client';

import dynamic from 'next/dynamic';

// Client-side only — TracedFlow uses xyflow, which touches the DOM.
const Inner = dynamic(() => import('./SubflowLensTryItInner'), {
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
      Loading the subflow view…
    </div>
  ),
});

/** The footprintjs-level (raw subflow) view of the Dynamic ReAct agent. */
export function SubflowLensTryIt() {
  return <Inner />;
}

export default SubflowLensTryIt;
