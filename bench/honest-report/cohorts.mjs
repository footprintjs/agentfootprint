import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const cohorts = {
  before: { agentfootprint: '14.10.1', footprintjs: '12.0.0', foottrace: '1.11.1' },
  after: { agentfootprint: '15.0.0', footprintjs: '14.0.0', foottrace: '2.1.0' },
};

export function loadCohort(label) {
  const path = new URL(`./cohorts/${label}/`, import.meta.url);
  const require = createRequire(new URL('package.json', path));
  const cohortRoot = fileURLToPath(path);
  const readLocal = (name) => {
    const file = fileURLToPath(new URL(name, path));
    if (!realpathSync(file).startsWith(cohortRoot)) throw new Error(`${label}: ${name} is outside its lock`);
    return readFileSync(file);
  };
  const pins = Object.entries(cohorts[label]).map(([name, expected]) => {
    const installed = JSON.parse(readLocal(`node_modules/${name}/package.json`));
    if (installed.version !== expected) throw new Error(`${label} ${name}: expected ${expected}`);
    return [name, installed.version];
  });
  const dependencyRoot = fileURLToPath(new URL('node_modules/', path));
  const local = (resolver, specifier) => {
    if (!realpathSync(resolver.resolve(specifier)).startsWith(dependencyRoot)) {
      throw new Error(`${label}: resolved ${specifier} outside its lock`);
    }
  };
  for (const specifier of ['agentfootprint', 'agentfootprint/observe', 'agentfootprint/context', 'agentfootprint/skill-graph']) {
    local(require, specifier);
  }
  const libraryRequire = createRequire(require.resolve('agentfootprint'));
  local(libraryRequire, 'footprintjs');
  local(libraryRequire, 'foottrace');
  local(createRequire(libraryRequire.resolve('footprintjs')), 'foottrace');
  const core = require('agentfootprint');
  const observe = require('agentfootprint/observe');
  const { defineSkill } = require('agentfootprint/context');
  const { skillGraph } = require('agentfootprint/skill-graph');
  const library = { ...core, ...observe, defineSkill, skillGraph };
  const lockDigest = createHash('sha256').update(readLocal('package-lock.json')).digest('hex');
  return { library, stamp: { ...Object.fromEntries(pins), lockDigest } };
}
