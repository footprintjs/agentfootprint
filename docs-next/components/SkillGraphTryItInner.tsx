'use client';

import '@xyflow/react/dist/style.css';
import { useMemo, type ReactNode } from 'react';
import { SkillGraphFlow } from 'agentfootprint-lens';
import type { SkillGraphDemoData } from './SkillGraphTryItData';
import { LIGHT_THEME, DARK_THEME, surfaceColors, useIsDark } from './demos/embedTheme';

/**
 * Draws a REAL skill-graph — the same code shown above it (via
 * <CodeFile region="demo">). <SkillGraphFlow> renders the structure the graph
 * already carries (`graph.nodes` / `graph.edges`): skill boxes, the synthetic
 * START chip, solid declared edges, and dashed `read_skill`-reachable edges.
 * Click a node to inspect its playbook + tools in the side panel — pulled from
 * the SAME compiled graph's skills, projected to plain data on the server.
 *
 * The server pairs the builder with the source file shown in the header. The
 * browser loads the interactive view, without the runtime needed to build/run
 * an agent. The actual runnable demos keep their own client-side builders.
 */

interface SkillGraphTryItInnerProps {
  /** Server-rendered <CodeFile region="demo"> of the builder, shown above the graph. */
  readonly code?: ReactNode;
  /** Plain view data built from the exact documented graph on the server. */
  readonly data: SkillGraphDemoData;
}

export default function SkillGraphTryItInner({ code, data }: SkillGraphTryItInnerProps) {
  const isDark = useIsDark();
  const { demo, file, graph, skills } = data;
  // Map each drawn node back to the skill it represents — the side-panel detail
  // comes from the compiled artifact's projection, so it cannot drift from what
  // the graph draws. Executors and predicates are not needed for inspection.
  const skillById = useMemo(
    () => new Map(skills.map((s) => [s.id, s] as const)),
    [skills],
  );
  const c = surfaceColors(isDark);

  return (
    <div className="tryit">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          margin: '0 2px 6px',
          fontSize: 12,
          color: c.chip,
        }}
      >
        <span>{file} — the exact graph drawn below</span>
        <span>declared === drawn</span>
      </div>
      <div style={{ marginBottom: 10, maxHeight: 360, overflow: 'auto', borderRadius: 12 }}>{code}</div>

      <div
        style={{
          ...(isDark ? DARK_THEME : LIGHT_THEME),
          height: 460,
          width: '100%',
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${c.border}`,
          background: c.panelBg,
          colorScheme: isDark ? 'dark' : 'light',
        }}
      >
        <SkillGraphFlow
          graph={graph}
          height="100%"
          detailFor={(node) => {
            if (node.kind !== 'skill') return undefined;
            const s = skillById.get(node.id);
            if (!s) return undefined;
            const tools = s.tools;
            return {
              title: node.label ?? node.id,
              description: s.description,
              body: s.body,
              ...(tools.length > 0 ? { tools } : {}),
            };
          }}
        />
      </div>
      <div style={{ fontSize: 13, color: c.chip, marginTop: 8 }}>
        {demo === 'quickstart' ? (
          <>
            ↑ Click a skill to see its playbook + the tools it unlocks. The edges from START
            are your start rules — the first that matches the user&apos;s message wins.
          </>
        ) : (
          <>
            ↑ Click a skill to see its playbook + the tools it unlocks. Solid edges are the{' '}
            <code>steps</code> you declared; dashed edges are skills the model can reach with{' '}
            <code>read_skill</code>.
          </>
        )}
      </div>
    </div>
  );
}
