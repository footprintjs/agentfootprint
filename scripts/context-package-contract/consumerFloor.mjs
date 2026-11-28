/** Install the original CI candidate at the declared engine floor in a separate consumer. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicProducerProbe } from './publicProducerProbe.mjs';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
assert.equal(process.argv.length, 3, 'Supply the original source-candidate directory');
const directory = resolve(process.argv[2]);
const candidate = await readJson(join(directory, 'candidate.json'));
const source = await readJson(join(directory, 'source-package.json'));
assert.equal(candidate.protocol, 'agentfootprint.source-candidate.v1');
assert.equal(candidate.archive.version, source.version);
assert.equal(source.peerDependencies.footprintjs, '^14.3.0');
const filename = candidate.archive.filename;
assert.equal(filename, basename(filename));
assert(filename.endsWith('.tgz'));
const archive = join(directory, filename);
assert.equal(
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex'),
  candidate.archive.sha256,
);

const floor = '14.3.0';
const foottrace = '2.3.2';
const consumer = await mkdtemp(join(tmpdir(), 'af-engine-floor-'));
try {
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'agentfootprint-engine-floor-smoke',
      private: true,
      dependencies: { agentfootprint: pathToFileURL(archive).href, footprintjs: floor, foottrace },
    }),
  );
  const options = { cwd: consumer, env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8' };
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--strict-peer-deps',
      '--no-audit',
      '--no-fund',
      '--registry',
      'https://registry.npmjs.org',
    ],
    options,
  );
  const lock = await readJson(join(consumer, 'package-lock.json'));
  for (const [name, version] of Object.entries({ footprintjs: floor, foottrace })) {
    const path = `node_modules/${name}`;
    assert.deepEqual(
      Object.keys(lock.packages).filter((key) => key.endsWith(path)),
      [path],
    );
    assert.equal(lock.packages[path].version, version);
    assert.equal((await readJson(join(consumer, path, 'package.json'))).version, version);
  }
  for (const format of ['cjs', 'esm']) {
    const probe = format === 'esm' ? 'probe.mjs' : 'probe.cjs';
    const loadAssert =
      format === 'cjs'
        ? "const assert = require('node:assert/strict');"
        : "import assert from 'node:assert/strict';";
    await writeFile(join(consumer, probe), loadAssert + publicProducerProbe(format));
    const output = execFileSync(process.execPath, [probe], options);
    const reports = output.split('\n').filter((line) => line.startsWith('af-public-producer '));
    assert.equal(reports.length, 1);
    const report = JSON.parse(reports[0].slice('af-public-producer '.length));
    assert.equal(report.format, format);
    assert.deepEqual(report.producer, {
      agentfootprintVersion: source.version,
      footprintjsVersion: floor,
    });
  }
  console.log(
    `Packed CJS and ESM consumers ran and recorded on FootPrint ${floor} + Foottrace ${foottrace}.`,
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
