/** The original source documents, never a paired setup lock, own the oracle. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readDocument(root, path) {
  assert.equal(await realpath(root), resolve(root), 'Context document root must not be an alias.');
  assert.ok((await lstat(root)).isDirectory(), 'Context document root must be a directory.');
  assert.equal(
    await realpath(dirname(path)),
    resolve(dirname(path)),
    'Context document parent must not be an alias.',
  );
  const before = await lstat(path);
  assert.ok(
    before.isFile() && !before.isSymbolicLink() && before.nlink === 1,
    'Context document must be an unaliased regular file.',
  );
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    assert.ok(
      opened.isFile() &&
        opened.nlink === 1 &&
        opened.dev === before.dev &&
        opened.ino === before.ino,
      'Context document changed before it was read.',
    );
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function setupIdentity(root) {
  return {
    manifestSha256: sha256(await readDocument(root, join(root, 'package.json'))),
    lockSha256: sha256(await readDocument(root, join(root, 'package-lock.json'))),
  };
}

export async function readSourceOracle(root) {
  const packageText = (await readDocument(root, join(root, 'package.json'))).toString('utf8');
  const lockText = (await readDocument(root, join(root, 'package-lock.json'))).toString('utf8');
  const metadata = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const bundled = metadata.bundleDependencies ?? metadata.bundledDependencies ?? [];
  assert.ok(
    bundled !== true && !bundled.includes('contextfootprint'),
    'ContextFootprint must be an ordinary registry dependency, not bundled.',
  );
  assert.match(
    metadata.dependencies?.contextfootprint ?? '',
    /^\d+\.\d+\.\d+$/,
    'The published manifest needs an exact version.',
  );
  assert.equal(
    lock.packages?.['']?.dependencies?.contextfootprint,
    metadata.dependencies.contextfootprint,
    'The source lock must match the manifest dependency.',
  );
  const lockedContext = lock.packages?.['node_modules/contextfootprint'];
  assert.equal(lockedContext?.version, metadata.dependencies.contextfootprint);
  assert.equal(
    lockedContext.resolved,
    `https://registry.npmjs.org/contextfootprint/-/contextfootprint-${metadata.dependencies.contextfootprint}.tgz`,
    'Source installs must resolve the published registry package.',
  );
  assert.match(
    lockedContext.integrity ?? '',
    /^sha512-[A-Za-z0-9+/]+={0,2}$/,
    'The tracked archive must retain its SHA-512 integrity.',
  );
  return {
    packageText,
    lockText,
    metadata,
    lockedContext,
    identity: { manifestSha256: sha256(packageText), lockSha256: sha256(lockText) },
  };
}

export async function checkInstalledContext(directory, { lockedContext }) {
  const installedLock = JSON.parse(
    (await readDocument(directory, join(directory, 'node_modules', '.package-lock.json'))).toString(
      'utf8',
    ),
  );
  const entries = Object.entries(installedLock.packages).filter(([path]) =>
    /(?:^|\/)node_modules\/contextfootprint$/.test(path),
  );
  assert.equal(
    entries.length,
    1,
    'The isolated install must resolve one ContextFootprint package.',
  );
  const [path, record] = entries[0];
  assert.equal(record.version, lockedContext.version);
  assert.equal(
    record.integrity,
    lockedContext.integrity,
    'Installed registry bytes must match the reviewed release.',
  );
  assert.equal(record.resolved, lockedContext.resolved);
  assert.ok(
    !isAbsolute(path) &&
      !path.includes('\\') &&
      path.split('/').every((part) => part && part !== '.' && part !== '..'),
    'The installed context record must remain inside its consumer.',
  );
  const location = await realpath(join(directory, path));
  assert.equal(
    location,
    resolve(directory, path),
    'Installed context package must not be an alias.',
  );
  const inside = relative(await realpath(directory), location);
  assert.ok(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`));
  const installedText = (await readDocument(location, join(location, 'package.json'))).toString(
    'utf8',
  );
  const installed = JSON.parse(installedText);
  assert.equal(
    installed.name,
    'contextfootprint',
    'Installed context package name must match its oracle.',
  );
  assert.equal(installed.version, lockedContext.version);
  return {
    path,
    realPath: location,
    version: record.version,
    resolved: record.resolved,
    integrity: record.integrity,
    manifestSha256: sha256(installedText),
  };
}

export function checkPackedContext(files) {
  assert.ok(
    !files.some((file) => /\.test\./.test(file.path)),
    'The Agent archive must not include tests.',
  );
  assert.ok(
    !files.some((file) => /(?:^|\/)node_modules\/contextfootprint(?:\/|$)/.test(file.path)),
    'The Agent archive must not bundle the registry dependency.',
  );
}
