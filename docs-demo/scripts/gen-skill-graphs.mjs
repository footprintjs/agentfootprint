import { deepStrictEqual } from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Agent, defineTool } from 'agentfootprint';
import { defineSkill, skillGraph } from 'agentfootprint/context';
import { routeRecorder } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import { buildSupportSkillGraph } from '../../docs-next/components/demos/skillGraphDemo.ts';
import { buildQuickstartSkillGraph } from '../../docs-next/components/demos/skillGraphQuickstartDemo.ts';
import { recordSkillGraphRuns } from '../../docs-next/components/demos/skillGraphRuns.mjs';
import { agentFootprintVersion, provenance } from './published-cohort.mjs';
import { renderSkillDiagram } from './render-skill-diagram.mjs';

const api = { defineTool, defineSkill, skillGraph };
const graphs = {
  quickstart: buildQuickstartSkillGraph(api),
  support: buildSupportSkillGraph(api),
};
const recordings = await recordSkillGraphRuns({ Agent, defineTool, mock, routeRecorder }, graphs);
const assetNames = { quickstart: 'skill-graph-quickstart', support: 'skills-explained' };
const docsAssets = new URL('../../docs-next/public/assets/', import.meta.url);
const docsFiles = new Map();
const figures = {};
const views = {};

for (const [name, compiled] of Object.entries(graphs)) {
  const [{ graph }] = recordings[name];
  const skills = compiled.skills.map((skill) => ({
    id: skill.id,
    ...(skill.description !== undefined && { description: skill.description }),
    ...(skill.inject.systemPrompt !== undefined && { body: skill.inject.systemPrompt }),
    tools: (skill.inject.tools ?? []).map((tool) => tool.schema.name),
  }));
  views[name] = { graph, skills };
  deepStrictEqual(structuredClone(views[name]), views[name]);
  deepStrictEqual(JSON.parse(JSON.stringify(views[name])), views[name]);

  const asset = assetNames[name];
  for (const theme of ['light', 'dark']) {
    const { svg, width, height } = renderSkillDiagram(graph, compiled.edges, provenance, theme);
    docsFiles.set(new URL(`${asset}-${theme}.svg`, docsAssets), svg);
    figures[name] = { asset, width, height };
  }
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';
docsFiles.set(new URL('../../docs-next/lib/skill-graph-figures.json', import.meta.url),
  json({ ...provenance, agentFootprintVersion, figures }));

const mode = process.argv[2];
if (mode === '--check') {
  for (const [file, content] of docsFiles) {
    deepStrictEqual(readFileSync(file, 'utf8'), content,
      `${file.pathname} differs. Run npm run gen:skill-graphs in docs-demo and commit the generated files.`);
  }
  console.log('The checked-in skill graph diagrams match fresh runs on the published cohort.');
} else {
  const generated = new URL('../src/generated/', import.meta.url);
  mkdirSync(generated, { recursive: true });
  writeFileSync(new URL('skill-graphs.json', generated), json({ provenance, ...views }));
  if (mode === '--write') {
    for (const [file, content] of docsFiles) writeFileSync(file, content);
  }
}

console.log(`Skill graph runs verified ${recordings.quickstart.length} entry rules and ${recordings.support.length} triage handoffs.`);
for (const run of [...recordings.quickstart, ...recordings.support]) {
  console.log(`${run.input} → ${run.hops.map(({ to }) => to).join(' → ')}`);
}
