// Copied canonical archive + source-manifest units from footprintjs/foottrace
// 3f4bbb6bd44e1046ab769a337a954e700bff4cad scripts/release-archive.cjs; see README.md for the closed AF path profile.
'use strict';
const { inflateRawSync } = require('node:zlib');
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
const hash = (bytes, algorithm, encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);
function text(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail();
  }
}
function field(bytes) {
  const end = bytes.indexOf(0);
  if (end >= 0 && bytes.subarray(end).some((n) => n !== 0)) fail();
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail();
  return text(end < 0 ? bytes : bytes.subarray(0, end));
}
function octal(bytes, { empty = false, checksum = false } = {}) {
  if (empty && bytes.every((n) => n === 0)) return 0;
  const value = bytes.toString('latin1');
  const shape = checksum
    ? /^[0-7]{6}(?:\0 | \0)$/
    : bytes.length === 8
    ? /^(?:[0-7]{7}\0|[0-7]{6} \0)$/
    : /^(?:[0-7]{11}\0|[0-7]{10} \0)$/;
  if (!shape.test(value)) fail();
  const n = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(n)) fail();
  return n;
}
function headerSize(header) {
  const magic = Buffer.from([117, 115, 116, 97, 114, 0, 48, 48]);
  if (!header.subarray(257, 265).equals(magic)) fail();
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  if (sum !== octal(header.subarray(148, 156), { checksum: true })) fail();
  octal(header.subarray(100, 108));
  for (const [start, end] of [
    [108, 116],
    [116, 124],
    [329, 337],
    [337, 345],
  ])
    if (octal(header.subarray(start, end), { empty: true }) !== 0) fail();
  octal(header.subarray(136, 148));
  // npm uses prefix/PAX for long or non-ASCII paths; this closed profile refuses them explicitly.
  if ([120, 103, 76, 75].includes(header[156]) || header.subarray(345, 500).some((n) => n !== 0))
    fail('archive-profile');
  // Portable regular-file packs have no link, owner, prefix or extension bytes.
  if (
    header[156] !== 48 ||
    header.subarray(157, 257).some((n) => n !== 0) ||
    header.subarray(265, 329).some((n) => n !== 0) ||
    header.subarray(345, 512).some((n) => n !== 0)
  )
    fail();
  return octal(header.subarray(124, 136));
}
function inspectArchive(bytes, expected) {
  try {
    const maxArchive = expected.maxArchiveBytes ?? 16 * 1024 * 1024;
    const maxExpanded = expected.maxExpandedBytes ?? 64 * 1024 * 1024;
    const maxFiles = expected.maxFiles ?? 10000;
    if (
      ![maxArchive, maxExpanded, maxFiles].every((n) => Number.isSafeInteger(n) && n > 0) ||
      !Buffer.isBuffer(bytes) ||
      bytes.length > maxArchive
    )
      fail();
    // One flags-zero gzip member only. Never publish bytes hidden after its trailer.
    if (
      bytes.length < 18 ||
      bytes[0] !== 31 ||
      bytes[1] !== 139 ||
      bytes[2] !== 8 ||
      bytes[3] !== 0
    )
      fail();
    const decoded = inflateRawSync(bytes.subarray(10), {
        maxOutputLength: maxExpanded,
        info: true,
      }),
      tar = decoded.buffer,
      trailer = 10 + decoded.engine.bytesWritten;
    if (
      trailer + 8 !== bytes.length ||
      bytes.readUInt32LE(trailer) !== crc32(tar) ||
      bytes.readUInt32LE(trailer + 4) !== tar.length
    )
      fail();
    if (tar.length % 512 !== 0) fail();
    const names = new Set(),
      files = [];
    let at = 0,
      identity = null,
      identityBytes = null,
      ended = false;
    while (at + 512 <= tar.length) {
      const header = tar.subarray(at, at + 512);
      at += 512;
      if (header.every((n) => n === 0)) {
        if (at + 512 > tar.length || !tar.subarray(at).every((n) => n === 0)) fail();
        ended = true;
        break;
      }
      const size = headerSize(header);
      const padded = Math.ceil(size / 512) * 512;
      if (at + padded > tar.length || tar.subarray(at + size, at + padded).some((n) => n !== 0))
        fail();
      const data = tar.subarray(at, at + size);
      at += padded;
      const name = field(header.subarray(0, 100));
      if (Buffer.byteLength(name) >= 100 || /[^\x20-\x7e]/.test(name)) fail('archive-profile');
      if (
        !name.startsWith('package/') ||
        /[\\\x00-\x1f]/.test(name) ||
        name.split('/').some((p) => p === '..' || p === '.' || p === '') ||
        names.has(name)
      )
        fail();
      if (
        ![
          'package/package.json',
          'package/README.md',
          'package/LICENSE',
          'package/AGENTS.md',
          'package/CAPABILITIES.md',
          'package/canonical-notes.json',
        ].includes(name) &&
        !['package/dist/', 'package/ai-instructions/', 'package/bin/'].some((prefix) =>
          name.startsWith(prefix),
        )
      )
        fail('archive-path');
      names.add(name);
      if (names.size > maxFiles) fail();
      files.push({ path: name, size, sha256: hash(data, 'sha256') });
      if (name === 'package/package.json') {
        if (size > 1024 * 1024) fail();
        identityBytes = data;
      }
    }
    // Validate every canonical member before parsing any manifest bytes.
    if (!ended || identityBytes === null) fail();
    identity = JSON.parse(text(identityBytes));
    if (!identity || typeof identity !== 'object' || Array.isArray(identity))
      fail('manifest-source', 'root');
    if (typeof identity.version !== 'string' || identity.version !== expected.version)
      fail('manifest-version');
    if (identity && Object.hasOwn(expected, 'sourceManifest'))
      requireSourceManifest(identity, expected.sourceManifest);
    if (
      !ended ||
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
  } catch (e) {
    if (refusals.has(e)) throw e;
    fail();
  }
}
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
  }
  return (n ^ 0xffffffff) >>> 0;
}
module.exports = { inspectArchive, archiveRefusalCode };
