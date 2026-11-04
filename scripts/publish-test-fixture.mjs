import assert from 'node:assert/strict';
import {
  chmodSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const active = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n\s*/g, ' ');
function job(name) {
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
) {
  const parent = os.tmpdir();
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'staged-')),
    bin = path.join(root, 'bin'),
    output = path.join(root, 'args');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(bin);
  writeFileSync(
    path.join(root, 'package.json'),
    manifestBytes ?? JSON.stringify({ name: 'agentfootprint', version, ...manifest }),
  );
  const npm = path.join(bin, 'npm');
  writeFileSync(npm, '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPM_ARGS"\n');
  chmodSync(npm, 0o700);
  const block = job('publish'),
    marker = '        run: |\n',
    at = block.lastIndexOf(marker);
  assert(at >= 0, 'actual publisher shell missing');
  const script = block
    .slice(at + marker.length)
    .split('\n')
    .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
    .join('\n');
  const r = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 512 * 1024,
      env: {
        PATH: bin + ':/usr/bin:/bin',
        NPM_ARGS: output,
        PLANNED_VERSION: planned,
        SOURCE_MANIFEST: JSON.stringify(
          sourceManifest ?? {
            name: 'agentfootprint',
            version: typeof version === 'string' && version.includes('-rc.') ? '13.2.0' : version,
          },
        ),
      },
    },
  );
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  assert(
    !/command not found|SyntaxError/.test(r.stderr),
    'publisher fixture setup failed: ' + r.stderr,
  );
  return { r, args: existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n') : [] };
}
