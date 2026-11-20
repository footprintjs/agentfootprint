import { deepStrictEqual, ok } from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Agent, defineTool } from 'agentfootprint';
import { defineFact, defineInstruction, defineSkill, defineSteering } from 'agentfootprint/context';
import { mock } from 'agentfootprint/providers';
import { structureGraphFromRunner } from 'agentfootprint-lens/core';
import { createTraceStructureRecorder, filterGraphForDrill } from 'footprint-explainable-ui/flowchart';
import { buildDynamicReactAgent } from '../shared/dynamicReactDemo.ts';
import { recordDynamicReactRun } from '../shared/recordDynamicReactRun.mjs';
import { agentFootprintVersion, provenance } from './published-cohort.mjs';
import { palettes, renderGraphvizDiagram } from './render-graphviz-diagram.mjs';

const trace = createTraceStructureRecorder();
const api = { Agent, defineTool, defineFact, defineInstruction, defineSkill, defineSteering, mock };
const agent = buildDynamicReactAgent(api, { thinkingMs: 0, structureRecorders: [trace.recorder] });
const recording = await recordDynamicReactRun(agent);

// Lens's raw projection preserves the compiled fork and join edges. The native
// structure recorder supplies the slot internals that the projection omits.
const compiled = structureGraphFromRunner(agent, { decorate: false });
const recorded = trace.getGraph();
const mounted = new Set(compiled.nodes.map(({ id }) => id));
const nested = [];
for (const parent of mounted) {
  for (const node of recorded.nodes) {
    if (node.data.subflowOf !== parent || mounted.has(node.id)) continue;
    nested.push(node);
    mounted.add(node.id);
  }
}
const nestedIds = new Set(nested.map(({ id }) => id));
const graph = {
  nodes: [...compiled.nodes, ...nested],
  edges: [...compiled.edges, ...recorded.edges.filter(({ source, target }) =>
    mounted.has(source) && mounted.has(target) && (nestedIds.has(source) || nestedIds.has(target)))],
};
const llm = 'sf-llm-call';
const view = filterGraphForDrill(graph, llm);
const slots = ['sf-system-prompt', 'sf-messages', 'sf-tools'];
deepStrictEqual(view.edges.filter(({ source }) => source === `${llm}/context`)
  .map(({ target }) => target.replace(`${llm}/`, '')).sort(), [...slots].sort());
for (const slot of slots) {
  ok(filterGraphForDrill(graph, `${llm}/${slot}`).nodes.length, `The raw view must drill into ${slot}.`);
}
ok(graph.edges.some(({ source, target, data }) =>
  source === 'tool-calls' && target === llm && data?.kind === 'loop'), 'Tools must loop back to the LLM call.');
deepStrictEqual(JSON.parse(JSON.stringify(graph)), graph);

function renderContextSlots(theme) {
  const colors = palettes[theme];
  const dotId = new Map(view.nodes.map(({ id }, index) => [id, `n${index}`]));
  const nodes = view.nodes.map(({ id, data }) =>
    `${dotId.get(id)} [label=${JSON.stringify(data.label)}${data.isDecider ? ', shape=diamond' : ''}];`);
  const edges = view.edges.map(({ source, target }) => `${dotId.get(source)} -> ${dotId.get(target)};`);
  return renderGraphvizDiagram(`digraph DynamicReAct {
    graph [bgcolor="${colors.background}", pad=0.18, ranksep=0.27, nodesep=0.20];
    node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=13,
      fillcolor="${colors.node}", color="${colors.line}", fontcolor="${colors.ink}", margin="0.12,0.07"];
    edge [color="${colors.line}", arrowsize=0.66];
    ${nodes.join('\n')}
    ${edges.join('\n')}
  }`, provenance);
}

const asset = 'dynamic-react-context';
const diagrams = ['light', 'dark'].map((theme) => ({ theme, ...renderContextSlots(theme) }));
const [{ width, height }] = diagrams;
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const docsFiles = [
  [new URL('../../docs-next/lib/dynamic-react-figure.json', import.meta.url),
    json({ ...provenance, agentFootprintVersion, figure: { asset, width, height }, recording })],
  ...diagrams.map(({ theme, svg }) => [
    new URL(`../../docs-next/public/assets/${asset}-${theme}.svg`, import.meta.url), svg,
  ]),
];

const mode = process.argv[2];
if (mode === '--check') {
  for (const [file, content] of docsFiles) {
    deepStrictEqual(readFileSync(file, 'utf8'), content,
      `${file.pathname} differs. Run npm run gen:dynamic-react in docs-demo and commit the generated files.`);
  }
  console.log('The checked-in Dynamic ReAct recording and diagrams match a fresh run on the published cohort.');
} else {
  const generated = new URL('../src/generated/', import.meta.url);
  mkdirSync(generated, { recursive: true });
  writeFileSync(new URL('dynamic-react.json', generated), json({ provenance, graph }));
  if (mode === '--write') {
    for (const [file, content] of docsFiles) writeFileSync(file, content);
  }
}
