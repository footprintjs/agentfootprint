'use client';

import dynamic from 'next/dynamic';

// Load the lens <Replay> client-side only — @xyflow/react touches the DOM, so it
// must not server-render. The Trace JSON is bundled at build (real run, not hand-authored).
const Inner = dynamic(() => import('./ReplayEmbedInner'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 560,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        border: '1px solid var(--af-border, #2a2a32)',
        color: 'var(--af-fg-muted, #8c887e)',
        fontSize: 14,
      }}
    >
      Loading the replay…
    </div>
  ),
});

export function ReplayEmbed() {
  return <Inner />;
}

export default ReplayEmbed;
