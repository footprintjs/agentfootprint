import assert from 'node:assert/strict';
import {
  chmodSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { archiveBytes } from './publish-archive/archive-fixture.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const active = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n\s*/g, ' ');
function job(name) {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
  const start = workflow.indexOf('\n  ' + name + ':\n');
  assert(start >= 0);
  const after = workflow.slice(start + 1),
    end = after.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return active(end < 0 ? after : after.slice(0, end + 1));
}
export function stagedPublish(
  t,
  version,
  planned = version,
  manifest = {},
  manifestBytes = null,
  sourceManifest = null,
  options = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'staged-')),
    bin = path.join(root, 'bin'),
    incoming = path.join(root, 'incoming'),
    publish = path.join(root, 'publish'),
    trusted = path.join(root, 'trusted'),
    output = path.join(root, 'args'),
    digest = path.join(root, 'digest');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of [bin, incoming, publish, trusted]) mkdirSync(folder);
  for (const name of ['archive.cjs', 'verify.cjs'])
    copyFileSync(path.join(ROOT, 'scripts/publish-archive', name), path.join(trusted, name));
  const bytes =
    options.archiveBytes ??
    archiveBytes({ name: 'agentfootprint', version, ...manifest }, { manifestBytes });
  writeFileSync(path.join(incoming, 'package.tgz'), bytes);
  for (const [name, value] of Object.entries(options.artifactSiblings ?? {}))
    writeFileSync(path.join(incoming, name), value);
  for (const [name, value] of Object.entries(options.publishSiblings ?? {}))
    writeFileSync(path.join(publish, name), value);
  const npm = path.join(bin, 'npm');
  writeFileSync(
    npm,
    '#!/bin/sh\nif [ "$1" = --version ]; then printf "%s\\n" "$NPM_VERSION"; exit 0; fi\n' +
      '[ "$1" = publish ] || exit 95\nprintf "%s\\n" "$@" > "$NPM_ARGS"\n' +
      'node -e \'const fs=require("node:fs"),c=require("node:crypto");fs.writeFileSync(process.env.NPM_DIGEST,c.createHash("sha256").update(fs.readFileSync("./package.tgz")).digest("hex"));\'\n',
  );
  chmodSync(npm, 0o700);
  const block = job('publish'),
    marker = '        run: |\n',
    at = block.lastIndexOf(marker);
  assert(at >= 0);
  const stepAt = block.lastIndexOf('      - name: Publish to npm\n');
  assert(stepAt >= 0);
  const declaredDirectory = /^        working-directory: (.+)$/m.exec(block.slice(stepAt))?.[1];
  const isolatedDirectory =
    '${{ runner.temp }}/af-publish-${{ github.run_id }}-${{ github.run_attempt }}';
  assert(
    declaredDirectory === undefined || declaredDirectory === isolatedDirectory,
    'unexpected native publish working-directory',
  );
  // GitHub uses the checkout workspace when this step omits working-directory.
  // Derive this from the specific Publish step, never the earlier npm upgrade.
  const workingDirectory = declaredDirectory === isolatedDirectory ? publish : root;
  const script = block
    .slice(at + marker.length)
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  const r = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 512 * 1024,
      env: {
        PATH: bin + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin',
        NPM_ARGS: output,
        NPM_DIGEST: digest,
        NPM_VERSION: options.npmVersion ?? '11.19.0',
        PLANNED_VERSION: planned,
        SOURCE_MANIFEST: JSON.stringify(
          sourceManifest ?? {
            name: 'agentfootprint',
            version: typeof version === 'string' && version.includes('-rc.') ? '13.2.0' : version,
          },
        ),
        VERIFY_DIR: trusted,
        INCOMING_DIR: incoming,
      },
    },
  );
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  assert(!/command not found|SyntaxError/.test(r.stderr), 'publisher fixture setup failure');
  return {
    r,
    args: existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n') : [],
    bytes,
    publishedSha256: existsSync(digest) ? readFileSync(digest, 'utf8') : null,
    root,
    workingDirectory,
    incoming,
    publish,
    trusted,
  };
}
