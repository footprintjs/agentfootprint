import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function contained(root, filename) {
  const path = relative(root, filename);
  return path !== '' && path !== '..' && !path.startsWith('../') && !isAbsolute(path);
}

export function verifyCandidate(root, lockRoot, lock, archive, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Provide the candidate SHA-256 in lowercase hex');
  const path = realpathSync(resolve(archive));
  if (!contained(root, path) || !path.endsWith('.tgz')) throw new Error('Candidate archive must be inside the benchmark');
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Candidate archive must be a bounded regular file');
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected) throw new Error('Candidate SHA-256 mismatch');
  const pin = lock.packages?.['node_modules/agentfootprint'];
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (typeof pin?.version !== 'string' || !pin.resolved?.startsWith('file:') ||
      resolve(lockRoot, pin.resolved.slice(5)) !== path || pin.integrity !== integrity || pin.link) {
    throw new Error('Candidate npm lock must install the verified archive with matching integrity');
  }
  return { archive: relative(root, path), sha256, version: pin.version };
}

export function packageTreeDigest(root) {
  const digest = createHash('sha256');
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        digest.update(JSON.stringify([relative(root, path), stat.size]));
        digest.update(readFileSync(path));
      } else throw new Error('Candidate installation contains a non-regular entry');
    }
  }
  walk(root);
  return digest.digest('hex');
}
