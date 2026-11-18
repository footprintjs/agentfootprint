'use strict';
const { createHash } = require('node:crypto');
const refusals = new WeakMap();
const fieldNames = new Set([
  'name',
  'version',
  'type',
  'description',
  'license',
  'author',
  'repository',
  'bugs',
  'homepage',
  'engines',
  'sideEffects',
  'main',
  'module',
  'types',
  'files',
  'exports',
  'scripts',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
  'bin',
  'dist',
  'tag',
  'publishConfig',
  'keywords',
  'packageManager',
  'workspaces',
  'root',
]);
const fail = (code = 'invalid-archive', key) => {
  const e = new Error(code);
  e.code = code;
  const field =
    key === undefined
      ? ''
      : ':' +
        (fieldNames.has(key)
          ? key
          : 'key-' + createHash('sha256').update(key).digest('hex').slice(0, 12));
  refusals.set(e, code + field);
  throw e;
};
const archiveRefusalCode = (error) => refusals.get(error);
const hash = (bytes, algorithm, encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);

const afRoots = Object.freeze([
  'package/package.json', 'package/README.md', 'package/LICENSE', 'package/AGENTS.md',
  'package/CAPABILITIES.md', 'package/canonical-notes.json',
]);
const afPrefixes = Object.freeze(['package/dist/', 'package/ai-instructions/', 'package/bin/']);
const nativeRoots = Object.freeze(['package/package.json', 'package/README.md', 'package/LICENSE', 'package/AGENTS.md']);
const contextRoots = Object.freeze(['package/package.json', 'package/README.md', 'package/LICENSE', 'package/CHANGELOG.md', 'package/NOTICE']);
const normalLimits = Object.freeze({ maxArchive: 16 * 1024 * 1024, maxExpanded: 64 * 1024 * 1024, maxFiles: 10000 });
const profiles = Object.freeze({
  footprintjs: Object.freeze({ version: '14.0.0', roots: nativeRoots, prefixes: Object.freeze(['package/dist/']), limits: normalLimits }),
  foottrace: Object.freeze({ version: '2.1.0', roots: nativeRoots, prefixes: Object.freeze(['package/dist/']), limits: normalLimits }),
  contextfootprint: Object.freeze({ version: '0.1.1', roots: contextRoots, prefixes: Object.freeze(['package/dist/', 'package/examples/']), limits: normalLimits }),
});
function publishedProfile(name) {
  if (typeof name !== 'string' || !Object.hasOwn(profiles, name)) fail('dependency-input');
  return profiles[name];
}
function memberAllowed(kind, name) {
  if (kind === 'af') return afRoots.includes(name) || afPrefixes.some((prefix) => name.startsWith(prefix));
  const profile = publishedProfile(kind);
  const parts = name.split('/');
  // These are setup surfaces, never inert package members for the dependency adapter.
  if (parts.some((part) => ['.npmrc', '.git', 'node_modules', 'npm-shrinkwrap.json', 'package-lock.json'].includes(part)) ||
      ['package/binding.gyp', 'package/server.js'].includes(name)) return false;
  return profile.roots.includes(name) || profile.prefixes.some((prefix) => name.startsWith(prefix));
}
module.exports = { fail, archiveRefusalCode, hash, memberAllowed, publishedProfile };
