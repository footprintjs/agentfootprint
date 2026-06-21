'use client';

import '@xyflow/react/dist/style.css';
import { TracedFlow } from 'footprint-explainable-ui/flowchart';
import data from '@/lib/generated/agent-flowchart.json';

/**
 * Renders the REAL footprintjs flowchart captured from the Quick-Start weather agent
 * (scripts/gen-agent-flowchart.mjs) with the pure footprint-explainable-ui <TracedFlow>.
 * Client-only (xyflow needs the DOM) — loaded via next/dynamic ssr:false by AgentFlowchart.
 */
const graph = data.graph as { nodes: { id: string }[]; edges: unknown[] };

// Render subflows (Injection Engine, the LLM-call group) as group boxes with their
// member stages nested inside, instead of click-to-zoom drill cards. A node is a
// subflow if some other node id is nested under it ("<id>/...").
const subflowIds = graph.nodes
  .map((n) => n.id)
  .filter((id) => graph.nodes.some((o) => o.id.startsWith(`${id}/`)));

export default function AgentFlowchartInner() {
  return (
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
  );
}
