'use client';

import '@xyflow/react/dist/style.css';
import { useMemo, type ReactNode } from 'react';
import { SkillGraphFlow } from 'agentfootprint-lens';
import { buildSupportSkillGraph } from './demos/skillGraphDemo';
import { LIGHT_THEME, DARK_THEME, surfaceColors, useIsDark } from './demos/embedTheme';

/**
 * Draws the REAL skill-graph from `buildSupportSkillGraph()` — the same builder
 * shown above (via <CodeFile region="demo">). <SkillGraphFlow> renders the
 * structure the graph already carries (`graph.nodes` / `graph.edges`): skill
 * boxes, the synthetic START chip, solid `route()` edges, and dashed
 * `read_skill`-reachable edges. Click a node to inspect its playbook + tools in
 * the side panel — pulled from the SAME `graph.skills`, not a separate fixture.
 */

interface SkillGraphTryItInnerProps {
  /** Server-rendered <CodeFile region="demo"> of the builder, shown above the graph. */
  readonly code?: ReactNode;
}

export default function SkillGraphTryItInner({ code }: SkillGraphTryItInnerProps) {
  const isDark = useIsDark();
  const graph = useMemo(() => buildSupportSkillGraph(), []);
  // Map each drawn node back to the skill it represents — the side-panel detail
  // is read straight off `graph.skills` (the compiled artifact), so it can never
  // drift from what the graph draws.
  const skillById = useMemo(
    () => new Map(graph.skills.map((s) => [s.id, s] as const)),
    [graph],
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
        <span>components/demos/skillGraphDemo.ts — the exact graph drawn below</span>
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
            const tools = (s.inject.tools ?? []).map((t) => t.schema.name);
            return {
              title: node.label ?? node.id,
              description: s.description,
              body: s.inject.systemPrompt,
              ...(tools.length > 0 ? { tools } : {}),
            };
          }}
        />
      </div>
      <div style={{ fontSize: 13, color: c.chip, marginTop: 8 }}>
        ↑ Click a skill to see its playbook + the tools it unlocks. Solid edges are{' '}
        <code>route()</code> transitions; dashed edges are skills the model can reach with{' '}
        <code>read_skill</code>.
      </div>
    </div>
  );
}
