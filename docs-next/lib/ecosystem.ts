export const ECOSYSTEM_PROJECTS = [
  {
    id: 'footprintjs',
    name: 'footprintjs',
    aliases: ['FootPrint'],
    description:
      'Execution provenance for backend systems, with typed reads and writes, decision evidence, backward slicing, and replay.',
    url: 'https://footprintjs.github.io/footPrint/',
    repo: 'https://github.com/footprintjs/footPrint',
    npm: 'https://www.npmjs.com/package/footprintjs',
  },
  {
    id: 'agentfootprint',
    name: 'AgentFootprint',
    aliases: ['agentfootprint'],
    description:
      'Context provenance and causal debugging for AI agents, including influence ranking, ablation, and counterfactual replay.',
    url: 'https://agentfootprint.dev/',
    repo: 'https://github.com/footprintjs/agentfootprint',
    npm: 'https://www.npmjs.com/package/agentfootprint',
  },
  {
    id: 'hcifootprint',
    name: 'HACI Footprint',
    aliases: ['hcifootprint'],
    description:
      'A typed capability and action graph that makes applications agent-operable while preserving permissions and human control.',
    url: 'https://footprintjs.github.io/hcifootprint/',
    repo: 'https://github.com/footprintjs/hcifootprint',
    npm: 'https://www.npmjs.com/package/hcifootprint',
  },
  {
    id: 'vizfootprint',
    name: 'VizFootprint',
    aliases: ['vizfootprint', 'FootTrail'],
    description:
      'Branchable provenance for human-agent visual analysis, with replay, comparison, mixed-principal causes, and statistical accountability.',
    url: 'https://github.com/footprintjs/vizfootprint',
    repo: 'https://github.com/footprintjs/vizfootprint',
  },
  {
    id: 'explainable-ui',
    name: 'Explainable UI',
    aliases: ['footprint-explainable-ui'],
    description:
      'Themeable React components for flowchart traversal, transactional state, time travel, and causal rewind.',
    url: 'https://footprintjs.github.io/explainable-ui/',
    repo: 'https://github.com/footprintjs/explainable-ui',
    npm: 'https://www.npmjs.com/package/footprint-explainable-ui',
  },
  {
    id: 'agentfootprint-lens',
    name: 'AgentFootprint Lens',
    aliases: ['Lens', 'agentfootprint-lens'],
    description:
      'A React debugger that aligns agent messages, prompts, tools, decisions, causal slices, and cost on one execution cursor.',
    url: 'https://github.com/footprintjs/agentfootprint-lens',
    repo: 'https://github.com/footprintjs/agentfootprint-lens',
    npm: 'https://www.npmjs.com/package/agentfootprint-lens',
  },
  {
    id: 'thinking-ui',
    name: 'Thinking UI',
    aliases: ['agentthinkingui', 'Agent Thinking UI'],
    description:
      'A scrubbable replay of agent reasoning, evidence, tools, and alternatives for non-developer audiences.',
    url: 'https://footprintjs.github.io/agentThinkingUI/',
    repo: 'https://github.com/footprintjs/agentThinkingUI',
    npm: 'https://www.npmjs.com/package/agentthinkingui',
  },
] as const;

export const ECOSYSTEM_ID = 'https://footprintjs.github.io/#ecosystem';
export const ORGANIZATION_ID = 'https://footprintjs.github.io/#organization';
export const CREATOR_ID = 'https://sanjay1909.github.io/#person';

export function projectSoftwareId(project: (typeof ECOSYSTEM_PROJECTS)[number]) {
  return project.id === 'agentfootprint'
    ? 'https://agentfootprint.dev/#software'
    : `${project.url}#software`;
}
