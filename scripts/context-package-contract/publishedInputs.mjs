/** Admit the three original public registry archives before any inner installation. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { inspectPublishedDependency } = require('../publish-archive/publishedDependency.cjs');

export async function admitPublishedInputs(inputs, directory) {
  const admitted = {};
  for (const [name, selected] of Object.entries(inputs.selected)) {
    const response = await fetch(selected.resolved, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, 'published archive request failed: ' + name);
    const length = response.headers.get('content-length');
    if (length !== null) assert(Number.isSafeInteger(Number(length)) && Number(length) <= 32 * 1024 * 1024);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert(size <= 32 * 1024 * 1024, 'published archive input bound');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const report = inspectPublishedDependency(bytes, { name, version: selected.version, integrity: selected.integrity });
    writeFileSync(join(directory, name + '.tgz'), bytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, name + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    admitted[name] = report;
  }
  return admitted;
}
