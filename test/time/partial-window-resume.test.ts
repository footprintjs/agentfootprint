/** Real JSON native checkpoints cross independent processes. The worker has no provider transport. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// BEGIN FIXED WORKER — captured verbatim for the separately bound old-runtime proof.
const WORKER = String.raw`
async function main(api, options) {
  const { Agent, defineTool, englishTimeReader, isInputPause, requestInput } = api;
  const FROM = '2026-10-09T13:00:00Z', TO = '2026-10-09T15:00:00Z';
  const seen = [], requests = [];
  const calls = options.kept
    ? [{id:'c1',name:'metric_series',args:{start:FROM}}, {id:'bridge',name:'checkpoint_bridge',args:{}}, {id:'c3',name:'metric_series',args:{start:FROM}}]
    : [{id:'c1',name:'metric_series',args:{start:FROM}}, {id:'c2',name:'cache_paths',args:{}}];
  let index = options.index || 0;
  const provider = { name:'fixed-partial-window', complete:async (request) => {
    requests.push(request);
    const call = calls[index++];
    if (index > calls.length + 1) throw Error('extra provider request');
    return { content:call ? '' : 'Done.', toolCalls:call ? [call] : [], usage:{input:0,output:0} };
  }};
  const tools = ['metric_series','cache_paths'].map(name => defineTool({
    name, description:'Read a synthetic interval.',
    inputSchema:{type:'object',required:['start','stop'],properties:{start:{type:'string'},stop:{type:'string'}}},
    askOrAssume:{start:{ask:'From when?'},stop:{ask:'Until when?'}},
    period:{forms:[{kind:'bounds',from:{argument:'start',as:'iso'},to:{argument:'stop',as:'iso',edge:'exclusive'}}]},
    ...(options.kept && name === 'metric_series' ? {checkIn:'always'} : {}),
    execute:(args,ctx)=>{seen.push({name,args:{...args},time:ctx.time});return {rows:[{value:1}]};}
  }));
  tools.push(defineTool({name:'checkpoint_bridge',description:'An inert pause before the target proposal.',
    inputSchema:{type:'object',properties:{}},
    execute:()=>requestInput({id:'bridge',question:'Continue the synthetic sequence?',fields:[{id:'go',type:'boolean',required:true}]})
  }));
  const agent = Agent.create({provider,model:'mock',reactMode:options.mode,maxIterations:6}).tools(tools)
    .time({zone:'UTC',reader:englishTimeReader(),policy:{year:'current'}}).build();
  try {
    let outcome;
    if (options.checkpoint) outcome = await agent.resume(options.checkpoint, options.reply);
    else {
      outcome = await agent.run({message:'Show metric series and cache paths in the last 2 hours',time:{now:'2026-10-09T16:00:00Z'}});
      if (options.completeOrdinary) {
        if (!isInputPause(outcome)) throw Error('missing ordinary input');
        outcome = await agent.resume(outcome.checkpoint,{requestId:outcome.awaitingInput.requestId,values:{f1:TO}});
      }
    }
    return {outcome,seen,requests,index,findings:agent.findings()};
  } finally {await agent.shutdown();}
}
main(require(process.argv[2]), JSON.parse(require('node:fs').readFileSync(process.argv[3],'utf8')))
  .then(value => process.stdout.write(JSON.stringify(value)))
  .catch(error => { process.stderr.write(String(error && error.stack || error)); process.exitCode=1; });
`;
// END FIXED WORKER

const ROOT = resolve(__dirname, '../..');
const folder = mkdtempSync(join(tmpdir(), 'af-partial-resume-'));
const api = join(folder, 'api.cjs');
const worker = join(folder, 'worker.cjs');
const zoneWorker = join(folder, 'worker-zone.cjs');
const admissionWorker = join(folder, 'worker-admission.cjs');
const unperiodedWorker = join(folder, 'worker-unperioded.cjs');
let attempt = 0;
beforeAll(async () => {
  writeFileSync(worker, WORKER);
  // The historical worker stays verbatim. This distinct worker varies only the
  // configured zone so each native phase can cross a fresh-process boundary.
  const zoneConfig = ".time({zone:'UTC',reader:";
  expect(WORKER.split(zoneConfig)).toHaveLength(2);
  writeFileSync(
    zoneWorker,
    WORKER.replace(zoneConfig, ".time({...(options.zone === null ? {} : {zone:'UTC'}),reader:"),
  );
  // Distinct current workers; the historical WORKER remains byte-exact.
  const terminal = '  } finally {await agent.shutdown();}';
  expect(WORKER.split(terminal)).toHaveLength(2);
  writeFileSync(
    admissionWorker,
    WORKER.replace(
      terminal,
      '  } catch (error) { return {refused:{name:error.name,code:error.code,message:error.message},seen,requests,index}; } finally {await agent.shutdown();}',
    ),
  );
  // A current producer without period forms may keep an ordinary endpoint.
  // A later current consumer with period forms must re-read its meaning.
  const periodLine = WORKER.split('\n').find((line) => line.trim().startsWith('period:{forms:'));
  if (periodLine === undefined) throw new Error('worker period declaration missing');
  const period = periodLine.trim().replace(/,$/, '');
  writeFileSync(
    unperiodedWorker,
    WORKER.replace(periodLine, '    ...(options.withoutPeriod ? {} : {' + period + '}),'),
  );
  await build({
    entryPoints: [join(ROOT, 'src/index.ts')],
    outfile: api,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    logLevel: 'silent',
  });
}, 30_000);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

function run(options: Record<string, unknown>, workerPath = worker) {
  const input = join(folder, `input-${++attempt}.json`);
  writeFileSync(input, JSON.stringify(options));
  const result = spawnSync(process.execPath, [workerPath, api, input], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, NODE_PATH: join(ROOT, 'node_modules'), NO_COLOR: '1' },
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
const fixtures = JSON.parse(
  readFileSync(join(ROOT, 'test/time/fixtures/partial-window-old-pause.json'), 'utf8'),
);
const reply = (outcome: any, value: unknown) => ({
  requestId: outcome.awaitingInput.requestId,
  values: { [outcome.awaitingInput.fields[0].id]: value },
});
for (const mode of ['dynamic', 'dynamic-grouped'])
  describe(`fresh process ${mode}`, () => {
    it.each(['ordinary', 'kept'] as const)(
      'refuses historical %s pauses before provider/tool work',
      (kind) => {
        const old = fixtures[mode][kind];
        expect(old.outcome.checkpoint.sharedState.runIdentitySource).toBeUndefined();
        expect(old.outcome.checkpoint.sharedState.runSessionId).toBeUndefined();
        expect(old.outcome.checkpoint.sharedState.toolResourceOwner).toBeUndefined();
        const refused = run(
          {
            mode,
            kept: kind === 'kept',
            index: old.index,
            checkpoint: old.outcome.checkpoint,
            reply: reply(old.outcome, kind === 'kept' ? true : '2026-10-09T15:00:00Z'),
          },
          admissionWorker,
        );
        expect(refused.refused).toEqual({
          name: 'TypeError',
          message:
            'Cannot resume this pause: the saved tool ownership carrier is missing or unreadable. Close this question and start a new run.',
        });
        expect(refused.index).toBe(old.index);
        expect(refused.requests).toEqual([]);
        expect(refused.seen).toEqual([]);
      },
    );

    it('keeps the original tool scope through fresh ordinary, zone and native-range processes', () => {
      const ordinary = run({ mode, zone: null }, zoneWorker);
      expect(ordinary.seen).toEqual([]);
      const zone = run(
        {
          mode,
          zone: null,
          index: ordinary.index,
          checkpoint: ordinary.outcome.checkpoint,
          reply: reply(ordinary.outcome, '2026-10-09T15:00:00Z'),
        },
        zoneWorker,
      );
      expect(zone.outcome.awaitingInput.fields[0].format).toBe('zone');
      expect(zone.seen).toEqual([]);
      expect(zone.requests).toEqual([]);
      const meaning = run(
        {
          mode,
          zone: null,
          index: zone.index,
          checkpoint: zone.outcome.checkpoint,
          reply: reply(zone.outcome, 'UTC'),
        },
        zoneWorker,
      );
      expect(meaning.outcome.awaitingInput.fields[0].format).toBe('time-range');
      expect(meaning.seen).toEqual([]);
      expect(meaning.requests).toEqual([]);
      expect(meaning.findings.filter((row: any) => row.kind === 'time-answer')).toEqual([]);
      const done = run(
        {
          mode,
          zone: null,
          index: meaning.index,
          checkpoint: meaning.outcome.checkpoint,
          reply: reply(meaning.outcome, '2026-10-09T14:00:00Z/2026-10-09T16:00:00Z'),
        },
        zoneWorker,
      );
      expect(done.seen).toHaveLength(2);
      expect(done.seen[0].args).toEqual({
        start: '2026-10-09T13:00:00Z',
        stop: '2026-10-09T15:00:00Z',
      });
      expect(done.findings.filter((row: any) => row.kind === 'time-answer')).toHaveLength(1);
    });
    it('current ordinary checkpoint regates its partial call across fresh processes', () => {
      const current = run({ mode });
      const meaning = run({
        mode,
        index: current.index,
        checkpoint: current.outcome.checkpoint,
        reply: reply(current.outcome, '2026-10-09T15:00:00Z'),
      });
      expect(meaning.seen).toEqual([]);
      expect(meaning.requests).toEqual([]);
      expect(meaning.outcome.awaitingInput?.fields?.[0]?.format).toBe('time-range');
      expect(meaning.findings.filter((r: any) => r.kind === 'time-answer')).toHaveLength(0);
      const done = run({
        mode,
        index: meaning.index,
        checkpoint: meaning.outcome.checkpoint,
        reply: reply(meaning.outcome, '2026-10-09T14:00:00Z/2026-10-09T16:00:00Z'),
      });
      expect(done.seen).toHaveLength(2);
      expect(done.seen[0].args).toEqual({
        start: '2026-10-09T13:00:00Z',
        stop: '2026-10-09T15:00:00Z',
      });
      expect(done.findings.filter((r: any) => r.kind === 'time-answer')).toHaveLength(1);
    });
    it('current kept endpoint crosses from an unperioded producer to a period-declaring consumer', () => {
      const current = run(
        { mode, kept: true, completeOrdinary: true, withoutPeriod: true },
        unperiodedWorker,
      );
      expect(current.seen).toEqual([]);
      expect(current.outcome.awaitingInput.id).toBe('bridge');
      expect(current.findings.filter((r: any) => r.kind === 'time-answer')).toHaveLength(0);
      const meaning = run({
        mode,
        kept: true,
        index: current.index,
        checkpoint: current.outcome.checkpoint,
        reply: reply(current.outcome, true),
      });
      expect(meaning.seen).toEqual([]);
      expect(meaning.requests).toHaveLength(1); // Only the target reproposal, never a second model call for this gate.
      expect(meaning.outcome.awaitingInput?.fields?.[0]?.format).toBe('time-range');
      const state = meaning.outcome.checkpoint;
      expect(JSON.stringify(state)).toContain('confirm-meaning');
      expect(
        meaning.findings.filter(
          (r: any) => r.kind === 'argument' && r.toolCallId === 'c3' && r.argument === 'stop',
        ),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'answered' })]));
      const done = run({
        mode,
        kept: true,
        index: meaning.index,
        checkpoint: meaning.outcome.checkpoint,
        reply: reply(meaning.outcome, '2026-10-09T14:00:00Z/2026-10-09T16:00:00Z'),
      });
      // The existing one-question-per-resume law refuses a second check-in in this pass.
      // Its reason reaches the next model request; no collector is silently authorized.
      expect(done.seen).toEqual([]);
      expect(done.findings.filter((r: any) => r.kind === 'time-answer')).toHaveLength(1);
      expect(JSON.stringify(done.requests)).toContain('no second pause');
    });
  });
