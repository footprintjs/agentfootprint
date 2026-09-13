import type { SkillGraphView } from 'agentfootprint-lens';
import { buildSupportSkillGraph } from './demos/skillGraphDemo';
import { buildQuickstartSkillGraph } from './demos/skillGraphQuickstartDemo';

const DEMOS = {
  support: { build: buildSupportSkillGraph, file: 'components/demos/skillGraphDemo.ts' },
  quickstart: { build: buildQuickstartSkillGraph, file: 'components/demos/skillGraphQuickstartDemo.ts' },
} as const;

export type SkillGraphDemo = keyof typeof DEMOS;
export interface SkillGraphDemoData {
  readonly demo: SkillGraphDemo;
  readonly file: string;
  readonly graph: SkillGraphView;
  readonly skills: readonly {
    readonly id: string;
    readonly description?: string;
    readonly body?: string;
    readonly tools: readonly string[];
  }[];
}

/** Build the exact documented demo on the server; send only what the view uses.
 * Matchers, tool executors and graph methods stay with the compiled server graph.
 * This projection contains no hand-authored topology or copied skill content.
 */
export function buildSkillGraphDemoData(demo: SkillGraphDemo = 'support'): SkillGraphDemoData {
  const { build, file } = DEMOS[demo];
  const graph = build();
  return {
    demo, file,
    graph: {
      nodes: graph.nodes.map(({ id, kind, label }) => ({ id, kind, ...(label !== undefined && { label }) })),
      edges: graph.edges.map(({ from, to, kind, label }) => ({ from, to, kind, ...(label !== undefined && { label }) })),
    },
    skills: graph.skills.map(skill => ({
      id: skill.id,
      ...(skill.description !== undefined && { description: skill.description }),
      ...(skill.inject.systemPrompt !== undefined && { body: skill.inject.systemPrompt }),
      tools: (skill.inject.tools ?? []).map(tool => tool.schema.name),
    })),
  };
}
