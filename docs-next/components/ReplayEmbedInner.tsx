'use client';

import '@xyflow/react/dist/style.css';
import { TracedFlow } from 'footprint-explainable-ui/flowchart';
import data from '@/lib/generated/replay-trace.json';

/**
 * Renders the OFFLINE REPLAY of a real run. `scripts/gen-replay-trace.mjs` captured a
 * `Trace` from the Quick-Start weather agent, round-tripped it through JSON, and rebuilt
 * the flowchart from `trace.structure` via the lens's `structureGraphFromSpec` — exactly
 * what `<Replay>` does, but at build time so the browser ships only the pure renderer
 * (footprint-explainable-ui), never the agent runtime. Client-only (xyflow needs the DOM).
 */
const graph = data.graph as { nodes: { id: string }[]; edges: unknown[] };
const meta = data.meta as { events: number; redaction: string; result: string };

// Render subflows (the LLM-call group, context slots) as group boxes with their member
// stages nested inside — a node is a subflow if some other node id is nested under it.
const subflowIds = graph.nodes
  .map((n) => n.id)
  .filter((id) => graph.nodes.some((o) => o.id.startsWith(`${id}/`)));

export default function ReplayEmbedInner() {
  return (
    <figure style={{ margin: 0 }}>
      <div
        style={{
          height: 560,
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--af-border, #2a2a32)',
          background: 'var(--af-bg-elev, #fff)',
        }}
      >
        <TracedFlow graph={graph as never} groupedSubflows={subflowIds} />
      </div>
      <figcaption
        style={{
          marginTop: 8,
          fontSize: 13,
          color: 'var(--af-fg-muted, #8c887e)',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span>↺ Rebuilt offline from a persisted Trace — no agent re-run</span>
        <span>· {meta.events} events</span>
        <span>· redaction: {meta.redaction}</span>
      </figcaption>
    </figure>
  );
}
