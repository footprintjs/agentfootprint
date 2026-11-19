'use strict';
const { types } = require('node:util');
const { readPublishedTar } = require('./tarReader.cjs');
const { parseManifest } = require('./strictJson.cjs');
const { fail, archiveRefusalCode, hash, publishedProfile } = require('./archivePolicy.cjs');

function selection(expected) {
  if (!expected || typeof expected !== 'object' || types.isProxy(expected) ||
      Object.getPrototypeOf(expected) !== Object.prototype) fail('dependency-input');
  const keys = Reflect.ownKeys(expected);
  const descriptors = Object.getOwnPropertyDescriptors(expected);
  if (keys.length !== 3 || !['name', 'version', 'integrity'].every((key) =>
    keys.includes(key) && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')))
    fail('dependency-input');
  const { name, version, integrity } = expected;
  const profile = publishedProfile(name);
  if (version !== profile.version || typeof integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity) ||
      `sha512-${Buffer.from(integrity.slice(7), 'base64').toString('base64')}` !== integrity)
    fail('dependency-input');
  return { name, version, integrity, profile };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Registry-selected data only: no source-commit, installation or runtime claim. */
function inspectPublishedDependency(bytes, expected) {
  try {
    const { name, version, integrity, profile } = selection(expected);
    if (types.isProxy(bytes) || !Buffer.isBuffer(bytes) || bytes.length < 1 ||
        bytes.length > profile.limits.maxArchive) fail('dependency-input');
    // Copy the one bounded observation. The same owned bytes are hashed BEFORE decoding.
    const held = Buffer.from(bytes);
    if (`sha512-${hash(held, 'sha512', 'base64')}` !== integrity) fail('dependency-integrity');
    const { identityBytes, files } = readPublishedTar(held, name);
    const manifest = parseManifest(identityBytes);
    if (manifest.name !== name || manifest.version !== version) fail('dependency-identity');
    if (Object.hasOwn(manifest, 'publishConfig')) {
      const config = manifest.publishConfig;
      if (name !== 'contextfootprint' || !config || typeof config !== 'object' || Array.isArray(config) ||
          Object.keys(config).length !== 2 || config.access !== 'public' ||
          config.registry !== 'https://registry.npmjs.org/') fail('dependency-manifest');
    }
    if (!files.some((file) => file.path.startsWith('package/dist/'))) fail('dependency-manifest');
    return freeze({
      manifest, package: name, version,
      sha256: hash(held, 'sha256'), shasum: hash(held, 'sha1'),
      integrity: `sha512-${hash(held, 'sha512', 'base64')}`, bytes: held.length, files,
    });
  } catch (error) {
    if (archiveRefusalCode(error)) throw error;
    fail('dependency-input');
  }
}

module.exports = { inspectPublishedDependency };
