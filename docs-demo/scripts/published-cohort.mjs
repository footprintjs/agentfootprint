import { ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = [
  'agentfootprint',
  'agentfootprint-lens',
  'footprint-explainable-ui',
  'footprintjs',
  'foottrace',
];
// Record the immutable published source commit alongside a reviewed version bump.
export const agentFootprintVersion = lock.packages['node_modules/agentfootprint'].version;
const releaseCommits = { '15.0.0': 'd966fbcd880bba639ac587f8fd59164772403a0e' };
ok(
  releaseCommits[agentFootprintVersion],
  `Record the release commit for AgentFootprint ${agentFootprintVersion}.`,
);

export const provenance = {
  commit: releaseCommits[agentFootprintVersion],
  cohort: packages.map((name) => `${name}@${lock.packages[`node_modules/${name}`].version}`),
};
