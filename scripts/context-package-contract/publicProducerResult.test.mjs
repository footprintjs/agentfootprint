import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { assertPublicProducerReports } from './publicProducerResult.mjs';
import { publicProducerProbe } from './publicProducerProbe.mjs';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';

function fixture() {
  const inputs = { source: { version: '15.0.0-rc.0' }, selected: { footprintjs: { version: '14.0.0-rc.0' } } };
  const graphs = {};
  const cases = ['consumer-online', 'consumer-offline'].map((caseId) => {
    const entries = Object.fromEntries(['cjs', 'esm'].map((format) => [format, Object.fromEntries(['agentfootprint', 'agentfootprint/providers', 'agentfootprint/observe'].map((name) => [name, '/owned/' + caseId + '/' + format + '/' + name + '.js']))]));
    graphs[caseId] = { agentfootprint: { entries } };
    return { caseId, commands: ['cjs', 'esm'].map((format) => ({ command: 'packed-' + format, execution: { exitCode: 0, signal: null }, stdout: 'af-public-producer ' + JSON.stringify({ format, producer: { agentfootprintVersion: inputs.source.version, footprintjsVersion: inputs.selected.footprintjs.version }, entries: Object.fromEntries(Object.entries(entries[format]).map(([name, file]) => [name, format === 'esm' ? pathToFileURL(file).href : file])) }) + '\n' })) };
  });
  return { evidence: { cases }, inputs, graphs };
}
test('joins four actual format/root reports to independent expected versions and entries', () => {
  const f = fixture();
  assert.equal(assertPublicProducerReports(f.evidence, f.inputs, f.graphs).length, 4);
});
for (const [name, mutate] of [
  ['missing root', (f) => f.evidence.cases.pop()],
  ['missing report', (f) => { f.evidence.cases[0].commands[0].stdout = ''; }],
  ['duplicate report', (f) => { f.evidence.cases[0].commands[0].stdout += f.evidence.cases[0].commands[0].stdout; }],
  ['failed actual command', (f) => { f.evidence.cases[0].commands[0].execution.exitCode = 1; }],
  ['wrong original producer version', (f) => { f.inputs.source.version = '15.0.0-rc.1'; }],
  ['wrong expected engine', (f) => { f.inputs.selected.footprintjs.version = '14.0.0-rc.1'; }],
  ['another installed image', (f) => { f.graphs['consumer-online'].agentfootprint.entries.cjs.agentfootprint = '/foreign/image.js'; }],
]) test('refuses ' + name, () => {
  const f = fixture();
  mutate(f);
  assert.throws(() => assertPublicProducerReports(f.evidence, f.inputs, f.graphs));
});

test('both code-owned public producer specimens parse without executing any package', () => {
  new Script(publicProducerProbe('cjs'));
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: publicProducerProbe('esm'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.throws(() => publicProducerProbe('foreign'));
});
