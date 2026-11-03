// Optional measurements: build first, then node bench/performance/run.mjs.
// No timing threshold belongs to a correctness or coverage gate.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { doorGuard } from '../../dist/hosting/doorGuard.js';
import { assessAnswer } from '../../dist/core/agent/assessment/assess.js';
import { accountForAnswer } from '../../dist/answer-account/index.js';
import { showLeaves } from '../../dist/answer-account/shown.js';

const root = new URL('../../', import.meta.url);
function record(size) {
  const history = [{ role: 'user', content: 'q' }];
  const coverageDeclared = [];
  for (let i = 0; i < size; i++) {
    history.push({ role: 'tool', toolCallId: `c${i}`, toolName: 't', content: i % 3 ? '[1]' : '[]' });
    if (i % 2 === 0) coverageDeclared.push({ kind: 'ledger', toolName: 't', toolCallId: `c${i}`,
      iteration: 1, checked: [{ what: 'x' }], notChecked: [], cannotCover: [] });
  }
  return { snapshot: { sharedState: { history, coverageDeclared } } };
}
const guard = doorGuard({ name: 'bench', allowedHosts: ['bot.example'] });
const request = { method: 'POST', headers: { host: 'bot.example', origin: 'https://bot.example',
  'content-type': 'application/json' } };
const large = record(2000);
const fixture = process.env.AF_ANSWER_ACCOUNT_RECORDING
  ?? new URL('../../test/answer-account/fixtures/turn2.recorded.json', import.meta.url);
const recordingText = readFileSync(fixture, 'utf8');
const declarations = { id: 'host-app', version: '1',
  skills: { 'array-inventory': { label: 'array estate report' } },
  tools: { powerstore_get_volumes: { rowsAt: 'volumes' } }, routing: { appDecides: true } };
let sink;
function measure(name, repetitions, call) {
  for (let i = 0; i < 10; i++) sink = call();
  const samplesMs = [];
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    for (let i = 0; i < repetitions; i++) sink = call();
    samplesMs.push(performance.now() - start);
  }
  return { name, repetitions, samplesMs, minMs: Math.min(...samplesMs) };
}
const sources = {};
for (const path of ['src/hosting/doorGuard.ts', 'src/core/agent/assessment/assess.ts']) {
  sources[path] = createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
  platform: process.platform, architecture: process.arch, sources,
  limitation: 'Local latency under these sample conditions, not a CI limit or all-operation complexity proof.',
  measurements: [measure('doorGuard allowed request', 100000, () => guard.check(request)),
    measure('assessAnswer fold plus JSON serialization: 2000 results and 1000 coverage rows', 500,
      () => JSON.stringify(assessAnswer(large))),
    measure('parse/account/show recording', 7, () => {
      const recording = JSON.parse(recordingText);
      const account = accountForAnswer(recording, declarations, { runId: 'run-1790361930311-2' });
      return showLeaves(account, recording, declarations);
    })],
  recording: { kind: process.env.AF_ANSWER_ACCOUNT_RECORDING ? 'provided' : 'reduced repository fixture',
    characters: recordingText.length,
    sha256: createHash('sha256').update(recordingText).digest('hex') },
  sinkUsed: sink !== undefined, runner: fileURLToPath(import.meta.url).split('/').slice(-3).join('/'),
}, null, 2));
