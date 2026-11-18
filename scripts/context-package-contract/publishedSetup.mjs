/** Pure setup documents for the one admitted published cohort. No IO or resolution. */
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertRecord } from './protocol.mjs';

const COHORT = Object.freeze({
  footprintjs: Object.freeze({ version: '14.0.0-rc.0', range: '^14.0.0-rc.0' }),
  foottrace: Object.freeze({ version: '2.1.0', range: '^2.1.0' }),
  contextfootprint: Object.freeze({ version: '0.1.1', range: '0.1.1' }),
});
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const requireThat = (condition, label) => {
  if (!condition) throw new TypeError(`context-package: invalid published ${label}`);
};
function record(value, label) {
  requireThat(
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
    label,
  );
  return value;
}
function document(text, label) {
  requireThat(typeof text === 'string', label);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    requireThat(false, label);
  }
  return record(value, label);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function selectedRecord(packages, name) {
  const expected = COHORT[name];
  const paths = Object.keys(packages).filter((key) => key.endsWith(`node_modules/${name}`));
  requireThat(paths.length === 1 && paths[0] === `node_modules/${name}`, `${name} owner`);
  const selected = record(packages[paths[0]], `${name} record`);
  requireThat(selected.version === expected.version, `${name} version`);
  requireThat(
    selected.resolved === `https://registry.npmjs.org/${name}/-/${name}-${expected.version}.tgz`,
    `${name} registry`,
  );
  const integrity = selected.integrity;
  requireThat(
    typeof integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity),
    `${name} integrity`,
  );
  const bytes = Buffer.from(integrity.slice(7), 'base64');
  requireThat(bytes.length === 64 && `sha512-${bytes.toString('base64')}` === integrity, `${name} integrity`);
  requireThat(!Object.hasOwn(selected, 'link'), `${name} link`);
  requireThat(selected.name === undefined || selected.name === name, `${name} name`);
  return selected;
}

function sourceVersion(version) {
  if (typeof version !== 'string' || version.length > 128) return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(version);
  return Boolean(match && match[0] === version &&
    match.slice(1).every((part) => part === undefined || Number.isSafeInteger(Number(part))));
}

/** Admit the original documents; exact ranges are a closed policy, not a SemVer implementation. */
export function getPublishedInputs(manifestText, lockText) {
  const manifest = document(manifestText, 'manifest');
  const lock = document(lockText, 'lock');
  requireThat(manifest.name === 'agentfootprint' && sourceVersion(manifest.version), 'source identity');
  requireThat(lock.lockfileVersion === 3 && lock.name === manifest.name && lock.version === manifest.version, 'lock identity');
  const dependencies = record(manifest.dependencies, 'dependencies');
  const peers = record(manifest.peerDependencies, 'peers');
  const dev = record(manifest.devDependencies, 'development dependencies');
  const packages = record(lock.packages, 'packages');
  const root = record(packages[''], 'lock root');
  requireThat(root.name === manifest.name && root.version === manifest.version, 'lock root identity');
  requireThat(dependencies.foottrace === COHORT.foottrace.range, 'foottrace range');
  requireThat(dependencies.contextfootprint === COHORT.contextfootprint.range, 'context range');
  requireThat(dependencies.footprintjs === undefined, 'existing engine dependency');
  requireThat(peers.footprintjs === COHORT.footprintjs.range && dev.footprintjs === peers.footprintjs, 'engine range');
  requireThat(root.dependencies?.foottrace === dependencies.foottrace, 'locked foottrace range');
  requireThat(root.dependencies?.contextfootprint === dependencies.contextfootprint, 'locked context range');
  requireThat(root.peerDependencies?.footprintjs === peers.footprintjs && root.devDependencies?.footprintjs === dev.footprintjs, 'locked engine range');
  for (const name of Object.keys(COHORT)) {
    requireThat(!Object.hasOwn(manifest.optionalDependencies ?? {}, name), `${name} optional dependency`);
  }
  requireThat(manifest.peerDependenciesMeta?.footprintjs?.optional !== true, 'required engine peer');
  // Existing unrelated constraints remain authored. A selected override/resolution is unsupported.
  for (const field of ['overrides', 'resolutions']) {
    requireThat(manifest[field] === undefined, field);
  }
  const selected = Object.fromEntries(Object.keys(COHORT).map((name) => [name, selectedRecord(packages, name)]));
  requireThat(selected.footprintjs.peerDependencies?.foottrace === COHORT.foottrace.range, 'engine record peer');
  return freeze({
    source: { name: manifest.name, version: manifest.version, manifestSha256: sha256(manifestText), lockSha256: sha256(lockText) },
    manifest,
    selected,
    policy: {
      sourceDocuments: 'immutable-oracle',
      sourceSetup: 'drop-dev-and-promote-required-engine-peer',
      consumerSetup: 'neutral-package-with-original-archive',
      resolution: 'normal-strict-npm-before-first-install',
    },
  });
}

function inputs(value) {
  assertRecord(value, ['source', 'manifest', 'selected', 'policy'], 'published inputs');
  requireThat(Object.isFrozen(value) && Object.isFrozen(value.manifest) && Object.isFrozen(value.selected), 'inputs');
  for (const [name, expected] of Object.entries(COHORT)) {
    requireThat(value.selected[name]?.version === expected.version, `${name} input`);
  }
  return value;
}

/** A detached temporary manifest, never a replacement for either original source document. */
export function sourceProductionManifest(value) {
  const held = inputs(value);
  const { devDependencies: _dev, ...manifest } = structuredClone(held.manifest);
  manifest.dependencies = {
    ...manifest.dependencies,
    footprintjs: held.selected.footprintjs.version,
    foottrace: held.selected.foottrace.version,
    contextfootprint: held.selected.contextfootprint.version,
  };
  return manifest;
}

/** IO owns archive bytes, membership and physical admission; this function only binds its data. */
export function consumerProductionManifest(value, artifact) {
  const held = inputs(value);
  assertRecord(artifact, ['path', 'sha256', 'sourceVersion'], 'published artifact');
  requireThat(artifact.sourceVersion === held.source.version, 'artifact version');
  requireThat(typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256), 'artifact digest');
  requireThat(
    typeof artifact.path === 'string' && artifact.path.length <= 4096 &&
      isAbsolute(artifact.path) && !artifact.path.includes('\0') && artifact.path.endsWith('.tgz'),
    'artifact path',
  );
  return {
    name: 'agentfootprint-context-package-consumer',
    private: true,
    type: 'module',
    dependencies: {
      agentfootprint: pathToFileURL(artifact.path).href,
      footprintjs: held.selected.footprintjs.version,
      foottrace: held.selected.foottrace.version,
    },
  };
}
