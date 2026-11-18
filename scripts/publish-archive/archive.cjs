// Copied canonical archive + source-manifest units from footprintjs/foottrace
// 3f4bbb6bd44e1046ab769a337a954e700bff4cad scripts/release-archive.cjs; see README.md for the closed AF path profile.
'use strict';
const { fail, archiveRefusalCode, hash } = require('./archivePolicy.cjs');
const { readAfTar, decodeArchiveText } = require('./tarReader.cjs');
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
      .join(',') +
    '}'
  );
}
function requireSourceManifest(manifest, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    fail('manifest-source', 'root');
  const keys = [...new Set([...Object.keys(manifest), ...Object.keys(source)])]
    .filter((key) => key !== 'version')
    .sort();
  for (const key of keys)
    if (
      !Object.hasOwn(manifest, key) ||
      !Object.hasOwn(source, key) ||
      canonical(manifest[key]) !== canonical(source[key])
    )
      fail('manifest-source', key);
}
function inspectArchive(bytes, expected) {
  try {
    const parsed = readAfTar(bytes, expected);
    const { identityBytes, files } = parsed;
    const identity = JSON.parse(decodeArchiveText(identityBytes));
    if (!identity || typeof identity !== 'object' || Array.isArray(identity))
      fail('manifest-source', 'root');
    if (typeof identity.version !== 'string' || identity.version !== expected.version)
      fail('manifest-version');
    if (identity && Object.hasOwn(expected, 'sourceManifest'))
      requireSourceManifest(identity, expected.sourceManifest);
    if (
      !identity ||
      identity.name !== expected.package ||
      identity.version !== expected.version ||
      Object.prototype.hasOwnProperty.call(identity, 'publishConfig') ||
      !files.some((f) => f.path.startsWith('package/dist/'))
    )
      fail();
    return {
      package: identity.name,
      version: identity.version,
      sha256: hash(bytes, 'sha256'),
      shasum: hash(bytes, 'sha1'),
      integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
      bytes: bytes.length,
      files,
    };
  } catch (error) {
    if (archiveRefusalCode(error)) throw error;
    fail();
  }
}
module.exports = { inspectArchive, archiveRefusalCode };
