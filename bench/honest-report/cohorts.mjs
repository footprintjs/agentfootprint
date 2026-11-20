import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { packageTreeDigest, verifyCandidate } from './candidate.mjs';

const published = { agentfootprint: '15.0.1', footprintjs: '14.0.0', foottrace: '2.1.0', contextfootprint: '0.1.1' };
const released16 = { ...published, agentfootprint: '16.0.0' };

export function loadCohort(label, candidate) {
  if (!['published', 'candidate', 'released16'].includes(label)) throw new Error('Unknown benchmark cohort');
  if (label === 'candidate' && candidate === undefined) throw new Error('Candidate archive proof required');
  const directory = label === 'published' ? 'after' : label;
  const path = new URL(`./cohorts/${directory}/`, import.meta.url);
  const require = createRequire(new URL('package.json', path));
  const cohortRoot = fileURLToPath(path);
  const readLocal = (name) => {
    const file = fileURLToPath(new URL(name, path));
    if (!realpathSync(file).startsWith(cohortRoot)) throw new Error(`${label}: ${name} is outside its lock`);
    return readFileSync(file);
  };
  const lockBytes = readLocal('package-lock.json');
  const archive = label === 'candidate' ? verifyCandidate(
    fileURLToPath(new URL('./', import.meta.url)), cohortRoot, JSON.parse(lockBytes), candidate.path, candidate.sha256,
  ) : undefined;
  const versions = label === 'released16' ? released16
    : archive === undefined ? published : { ...published, agentfootprint: archive.version };
  const lock = JSON.parse(lockBytes);
  const packageEntry = lock.packages?.['node_modules/agentfootprint'];
  if (label === 'released16' &&
      (packageEntry?.resolved !== 'https://registry.npmjs.org/agentfootprint/-/agentfootprint-16.0.0.tgz' ||
       !/^sha512-[A-Za-z0-9+/=]+$/.test(packageEntry.integrity))) {
    throw new Error('The released cohort needs the npm 16.0.0 tarball and integrity in its lock');
  }
  for (const [name, expected] of Object.entries(versions)) {
    const installed = JSON.parse(readLocal(`node_modules/${name}/package.json`));
    if (installed.version !== expected || lock.packages?.[`node_modules/${name}`]?.version !== expected) {
      throw new Error(`${label} ${name}: expected lock and installed version ${expected}`);
    }
  }
  const local = (resolver, specifier, name = specifier) => {
    const packageRoot = fileURLToPath(new URL(`node_modules/${name}/`, path));
    if (!realpathSync(resolver.resolve(specifier)).startsWith(packageRoot)) {
      throw new Error(`${label}: resolved ${specifier} outside its pinned package`);
    }
  };
  for (const specifier of ['agentfootprint', 'agentfootprint/observe', 'agentfootprint/context', 'agentfootprint/skill-graph']) {
    local(require, specifier, 'agentfootprint');
  }
  const libraryRequire = createRequire(require.resolve('agentfootprint'));
  for (const dependency of ['footprintjs', 'foottrace', 'contextfootprint']) local(libraryRequire, dependency);
  local(createRequire(libraryRequire.resolve('footprintjs')), 'foottrace');
  const packageSha256 = archive !== undefined || label === 'released16'
    ? packageTreeDigest(realpathSync(fileURLToPath(new URL('node_modules/agentfootprint', path))))
    : undefined;
  const core = require('agentfootprint');
  const observe = require('agentfootprint/observe');
  const { defineSkill } = require('agentfootprint/context');
  const { skillGraph } = require('agentfootprint/skill-graph');
  const library = { ...core, ...observe, defineSkill, skillGraph };
  const lockDigest = createHash('sha256').update(lockBytes).digest('hex');
  return { library, stamp: {
    ...versions, lockDigest, ...(packageSha256 && { packageSha256 }), ...(archive && { archive }),
  } };
}
