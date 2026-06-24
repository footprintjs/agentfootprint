'use client';

import '@xyflow/react/dist/style.css';
import { useMemo, useState, type ReactNode } from 'react';
import { TracedFlow, filterGraphForDrill, buildSubflowBreadcrumb } from 'footprint-explainable-ui/flowchart';
import type { TraceGraph } from 'footprint-explainable-ui/flowchart';
import { structureGraphFromRunner } from 'agentfootprint-lens/core';
import { buildDynamicReactAgent } from './demos/dynamicReactDemo';
import { LIGHT_THEME, DARK_THEME, surfaceColors, useIsDark } from './demos/embedTheme';

/**
 * The footprintjs-LEVEL view of the SAME agent. The agent <Lens> draws agent
 * vocabulary (the LLM card, slot pills, tokens). This strips ALL of that with
 * `structureGraphFromRunner(agent, { decorate: false })` and draws the RAW
 * footprintjs subflow tree: `sf-injection-engine`, the three context slots
 * (`sf-system-prompt` ∥ `sf-messages` ∥ `sf-tools`) as the real parallel fan-out
 * they are, `sf-cache`, `call-llm`. Every box is a plain footprintjs stage —
 * proof that "the agent is just footprintjs subflows underneath."
 *
 * Click a subflow box to drill in; the breadcrumb pops back out. No agent runtime
 * is needed — the structure comes straight off the compiled chart spec.
 */

// The LLM-call subflow holds the request-assembly tree — open there so the slots
// are visible immediately, with a breadcrumb back to the full chart.
const LLM_CALL_SUBFLOW = 'sf-llm-call';

interface SubflowLensTryItInnerProps {
  readonly caption?: ReactNode;
}

export default function SubflowLensTryItInner(_props: SubflowLensTryItInnerProps) {
  const isDark = useIsDark();
  const c = surfaceColors(isDark);

  // Build the agent ONCE and take its raw (un-decorated) structure graph.
  const fullGraph = useMemo<TraceGraph>(
    () => structureGraphFromRunner(buildDynamicReactAgent(), { decorate: false }),
    [],
  );

  // Drill state. Default into the LLM call so the assembly subflows show on load;
  // fall back to the top level if that subflow isn't present (defensive).
  const hasLlmCall = useMemo(
    () => fullGraph.nodes.some((n) => n.id === LLM_CALL_SUBFLOW || n.id.endsWith('/' + LLM_CALL_SUBFLOW)),
    [fullGraph],
  );
  const [drill, setDrill] = useState<string | null>(hasLlmCall ? LLM_CALL_SUBFLOW : null);

  const view = useMemo(() => filterGraphForDrill(fullGraph, drill), [fullGraph, drill]);
  const crumbs = useMemo(() => buildSubflowBreadcrumb(fullGraph, drill), [fullGraph, drill]);

  return (
    <div className="tryit">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '0 2px 6px', fontSize: 12, color: c.chip, flexWrap: 'wrap' }}>
        {crumbs.map((entry, i) => (
          <span key={entry.subflowId ?? '__root__'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ opacity: 0.5 }}>›</span>}
            <button
              onClick={() => setDrill(entry.subflowId)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: i === crumbs.length - 1 ? 'default' : 'pointer',
                color: i === crumbs.length - 1 ? c.inputFg : c.chip,
                fontSize: 12,
                fontWeight: i === crumbs.length - 1 ? 600 : 400,
                textDecoration: i === crumbs.length - 1 ? 'none' : 'underline',
              }}
            >
              {entry.label}
            </button>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', opacity: 0.8 }}>raw footprintjs subflows · no agent vocabulary</span>
      </div>

      <div
        style={{
          ...(isDark ? DARK_THEME : LIGHT_THEME),
          height: 520,
          width: '100%',
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${c.border}`,
          background: c.panelBg,
          colorScheme: isDark ? 'dark' : 'light',
        }}
      >
        <TracedFlow graph={view} onSubflowChange={setDrill} />
      </div>

      <div style={{ fontSize: 13, color: c.chip, marginTop: 8 }}>
        ↑ The same agent, drawn as plain footprintjs subflows. The three context slots run as a{' '}
        <strong>parallel fan-out</strong>; <code>sf-injection-engine</code> decides what each slot composes.
        Click any subflow box to drill in.
      </div>
    </div>
  );
}
