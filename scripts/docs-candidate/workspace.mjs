/** Keep all candidate installs, generated pages and exports in a disposable CI checkout. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const tracked = ['docs-next/package.json', 'docs-next/package-lock.json',
  'docs-next/vendor/storydeck/storydeck-0.2.0.tgz'];

function snapshot(root) {
  const files = Object.fromEntries(tracked.map((file) => [file,
    createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]));
  return { root, head: git(root, 'rev-parse', 'HEAD'), files,
    status: git(root, 'status', '--porcelain=v1', '--untracked-files=all') };
}

export function openWorkspace(source, temp, expectedHead) {
  source = realpathSync(source);
  const original = snapshot(source);
  assert.equal(original.head, expectedHead, 'wrong CI checkout');
  assert.equal(original.status, '', 'candidate requires a clean checkout');
  const dir = mkdtempSync(join(realpathSync(temp), 'af-docs-'));
  try {
    const root = join(dir, 'checkout');
    execFileSync('git', ['clone', '-q', '--local', '--no-checkout', source, root]);
    git(root, 'checkout', '-q', '--detach', expectedHead);
    assert.deepEqual(snapshot(root), { ...original, root });
    mkdirSync(join(dir, 'inputs'), { mode: 0o700 });
    writeFileSync(join(dir, 'original.json'), JSON.stringify(original), { flag: 'wx' });
    return { dir, root, inputs: join(dir, 'inputs') };
  } catch (error) {
    rmSync(dir, { recursive: true });
    throw error;
  }
}

export function closeWorkspace(source, temp, dir) {
  source = realpathSync(source);
  assert(lstatSync(dir).isDirectory() && dirname(realpathSync(dir)) === realpathSync(temp));
  assert(/^af-docs-[a-zA-Z0-9]{6}$/.test(basename(dir)));
  const original = JSON.parse(readFileSync(join(dir, 'original.json'), 'utf8'));
  assert.equal(original.root, source);
  rmSync(dir, { recursive: true });
  assert.deepEqual(snapshot(source), original, 'source checkout changed during candidate docs checks');
  assert(!existsSync(dir));
  console.log('Removed the candidate checkout and verified original docs inputs', original.files);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_WORKSPACE, GITHUB_SHA, GITHUB_OUTPUT, RUNNER_TEMP } = process.env;
  if (process.argv[2] === 'open') {
    const paths = openWorkspace(GITHUB_WORKSPACE, RUNNER_TEMP, GITHUB_SHA);
    appendFileSync(GITHUB_OUTPUT, Object.entries(paths).map(([key, value]) => key + '=' + value + '\n').join(''));
  } else {
    assert.equal(process.argv[2], 'close');
    closeWorkspace(GITHUB_WORKSPACE, RUNNER_TEMP, process.argv[3]);
  }
}
