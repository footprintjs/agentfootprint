/** Internal orchestration. The CLI supplies only its fixed, admitted input table. */
import assert from 'node:assert/strict';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync,
  rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { validateProvider } from './provider.mjs';
import { readOriginalMember, sha256 } from './zipMember.mjs';
import { apiOperation, inputFailure } from './failures.mjs';

function outsideSource(destination, source) {
  assert(typeof destination === 'string' && isAbsolute(destination), 'docs-input-absolute-output');
  const out = join(realpathSync(dirname(destination)), basename(destination));
  const rel = relative(realpathSync(source), out);
  assert(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel), 'docs-input-output-outside-source');
  if (existsSync(out)) {
    const stat = lstatSync(out);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'docs-input-output-directory');
    assert.equal(readdirSync(out).length, 0, 'docs-input-output-empty');
  } else mkdirSync(out, { mode: 0o700 });
  return out;
}

function inspectProvider(selected, reader) {
  const api = (path) => {
    const endpoint = `repos/${selected.repository}/${path}`;
    try { return JSON.parse(reader.get(endpoint)); }
    catch (error) { throw inputFailure(error, apiOperation(endpoint)); }
  };
  const actual = {
    source: api(`git/commits/${selected.source.head}`),
    tested: api(`git/commits/${selected.tested.head}`),
    runs: selected.runs.map((run) => ({ run: api(`actions/runs/${run.id}`),
      jobs: api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`) })),
    artifact: api(`actions/artifacts/${selected.artifact.id}`),
  };
  validateProvider(selected, actual);
}

export function collectOriginalInputs(inputs, destination, source, reader) {
  const out = outsideSource(destination, source);
  const written = [];
  const save = (filename, bytes) => {
    const path = join(out, filename);
    const fd = openSync(path, 'wx', 0o600);
    written.push(path);
    try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
  };
  try {
    // Admit every provider first. A pending/changed producer causes no ZIP download.
    for (const selected of inputs) {
      try { inspectProvider(selected, reader); }
      catch (error) { throw inputFailure(error, { repository: selected.repository,
        operation: 'metadata', runId: selected.artifact.runId, artifactId: selected.artifact.id }); }
    }
    for (const selected of inputs) {
      const zip = reader.get(`repos/${selected.repository}/actions/artifacts/${selected.artifact.id}/zip`,
        64 * 1024 * 1024);
      let bytes;
      try { bytes = readOriginalMember(zip, selected); }
      catch (error) { throw inputFailure(error, { repository: selected.repository,
        operation: 'original-member', artifactId: selected.artifact.id, member: selected.artifact.member }); }
      save(selected.filename, bytes);
    }
    const receipt = { protocol: 'agentfootprint.docs-original-inputs.v1',
      qualification: 'original admitted package bytes only; consumer gates still required',
      inputs, inputTableSha256: sha256(Buffer.from(JSON.stringify(inputs))) };
    save('inputs.json', `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  } catch (error) {
    // Only files this invocation wrote, never another task's files or entire directories.
    for (const path of written) rmSync(path);
    throw error;
  }
}
