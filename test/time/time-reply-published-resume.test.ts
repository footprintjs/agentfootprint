/**
 * A real published 14.1.1 native pause resumes in an independent current-code
 * process. Only current src/index is bundled; installed current dependencies
 * stay external. The historical writer is never imported or rerun here.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AwaitingInput, InputField, RunnerPauseOutcome } from '../../src/index.js';

const ROOT = resolve(__dirname, '../..');
const FIXTURES = join(ROOT, 'test/time/fixtures');
const PAUSE = join(FIXTURES, 'time-reply-published-14.1.1-pause.json');
const MANIFEST = join(FIXTURES, 'time-reply-published-14.1.1-manifest.json');
const WRITER = join(FIXTURES, 'writer-14.1.1');
const PAUSE_SHA = '1b4b58013360e85edef9e34a8da1c19b80cc9b0e47677c1037bb3d043ae7f592';
const MANIFEST_SHA = '069a56dfd758dc0d723e4b2d098d8e71019c16d4ac0620d1ec73c0a2cacb789a';
const RAW_MANIFEST_SHA = '6b5c14c04f9818b6c1caabb561e4b6bd617243c92828b58f78149e345b3008cc';
const LOCK_SHA = '9266b53f817e323eed949138e1b64b04aa0bbf53939b81b84ff37b6ac5748efe';
const WRITER_SHA = '4d1fe995ea499ac1f26e0521ed3b402adaabba408bd038ad944d9f373954a15f';
const MESSAGE = 'Show activity in the last 2 hours';
const CLOCK = { now: '2026-11-06T18:01:00Z', zone: 'UTC' };
const ORIGINAL_EFFECT = {
  start_time: Date.parse('2026-11-06T16:01:00Z'),
  // Existing offered-lookback -> exclusive-bounds law, not the proposal's +1ms.
  end_time: Date.parse(CLOCK.now),
};
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

interface PublishedManifest {
  readonly kind: string;
  readonly node: string;
  readonly packages: Readonly<
    Record<
      string,
      {
        readonly version: string;
        readonly resolved: string;
        readonly integrity: string;
        readonly entrySHA256: string;
      }
    >
  >;
  readonly checkpointSHA256: string;
  readonly lockSHA256: string;
  readonly writerSHA256: string;
  readonly message: string;
  readonly clock: typeof CLOCK;
  readonly rangeField: InputField;
  readonly toolEffects: number;
  readonly projection: {
    readonly sourceManifestSHA256: string;
    readonly sourceArtifact: number;
    readonly sourceRun: number;
    readonly sourceAttempt: number;
    readonly packageRootBase: 'repository';
  };
}
const manifest = read(MANIFEST) as PublishedManifest;

// Same public tool/time/config as fixtures/writer-14.1.1/write.mjs. Only the
// provider's next response differs: a legacy resume has already proposed its call.
const WORKER = String.raw`
const fs = require('node:fs');
async function main(api, options) {
  const { Agent, defineTool, englishTimeReader, isInputPause } = api;
  const message = 'Show activity in the last 2 hours';
  const clock = {now:'2026-11-06T18:01:00Z',zone:'UTC'};
  const seen = [], requests = [];
  let completed = 0;
  const provider = {
    name:'fixed-native-time-reply',
    complete:async (request) => {
      requests.push(request);
      if (requests.length > 1) throw Error('Unexpected extra provider request');
      return options.phase === 'resume'
        ? {content:'Done.',toolCalls:[],usage:{input:0,output:0}}
        : {content:'',toolCalls:[{id:'read-1',name:'read_window',args:{}}],usage:{input:0,output:0}};
    },
  };
  const tool = defineTool({
    name:'read_window',description:'Read one synthetic interval.',
    inputSchema:{type:'object',properties:{start_time:{type:'integer'},end_time:{type:'integer'}}},
    askOrAssume:{start_time:{ask:'From when?'},end_time:{ask:'Until when?'}},
    period:{forms:[{kind:'bounds',from:{argument:'start_time',as:'epoch-ms'},to:{argument:'end_time',as:'epoch-ms',edge:'exclusive'}}]},
    execute:(args)=>{seen.push(args);completed++;return {rows:[{value:1}]};},
  });
  const agent = Agent.create({provider,model:'mock',maxIterations:3}).tool(tool)
    .time({zone:'UTC',reader:englishTimeReader(),policy:{year:'current'}}).build();
  try {
    const before = {toolEffects:completed,providerRequests:requests.length};
    let outcome, legacyRequest;
    if (options.phase === 'resume') {
      // Parse the saved bytes, without adapting, patching or relabeling any field.
      const checkpoint = JSON.parse(fs.readFileSync(options.checkpointFile,'utf8'));
      legacyRequest = checkpoint.pauseData.awaitingInput;
      if (!legacyRequest || legacyRequest.fields.length !== 1)
        throw Error('Expected the unmodified published request');
      const range = legacyRequest.fields[0];
      if (range.format !== 'time-range' || typeof range.enum[0] !== 'string')
        throw Error('Expected the published ISO range choice');
      outcome = await agent.resume(checkpoint,{
        requestId:legacyRequest.requestId,values:{[range.id]:range.enum[0]},
      });
    } else {
      outcome = await agent.run({message,time:clock});
    }
    return {
      outcome,before,seen,requests,completed,legacyRequest,
      awaitingInput:isInputPause(outcome) ? outcome.awaitingInput : undefined,
      findings:agent.findings(),
    };
  } finally {await agent.shutdown();}
}
main(require(process.argv[2]),JSON.parse(fs.readFileSync(process.argv[3],'utf8')))
  .then(value=>process.stdout.write(JSON.stringify(value)))
  .catch(error=>{process.stderr.write(String(error && error.stack || error));process.exitCode=1;});
`;

const folder = mkdtempSync(join(tmpdir(), 'af-time-published-resume-'));
const api = join(folder, 'api.cjs');
const worker = join(folder, 'worker.cjs');
let attempt = 0;
beforeAll(async () => {
  writeFileSync(worker, WORKER);
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

interface WorkerResult {
  readonly outcome: string | RunnerPauseOutcome;
  readonly before: { readonly toolEffects: number; readonly providerRequests: number };
  readonly seen: readonly Record<string, unknown>[];
  readonly requests: readonly unknown[];
  readonly completed: number;
  readonly legacyRequest?: AwaitingInput;
  readonly awaitingInput?: AwaitingInput;
  readonly findings: readonly { readonly kind: string; readonly [key: string]: unknown }[];
}
function run(phase: 'fresh' | 'resume'): WorkerResult {
  const input = join(folder, `input-${++attempt}.json`);
  writeFileSync(input, JSON.stringify({ phase, checkpointFile: PAUSE }));
  const result = spawnSync(process.execPath, [worker, api, input], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, NODE_PATH: join(ROOT, 'node_modules'), NO_COLOR: '1' },
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as WorkerResult;
}

describe('actual published 14.1.1 time request -> current native resume', () => {
  it('binds the immutable checkpoint and portable manifest to the actual writer and normal registry lock', () => {
    expect(hash(readFileSync(PAUSE))).toBe(PAUSE_SHA);
    expect(hash(readFileSync(MANIFEST))).toBe(MANIFEST_SHA);
    expect(hash(readFileSync(join(WRITER, 'package-lock.json')))).toBe(LOCK_SHA);
    expect(hash(readFileSync(join(WRITER, 'write.mjs')))).toBe(WRITER_SHA);
    expect(manifest).toMatchObject({
      kind: 'PORTABLE_PUBLISHED_NATIVE_WRITER_FIXTURE',
      node: 'v24.22.2',
      checkpointSHA256: PAUSE_SHA,
      lockSHA256: LOCK_SHA,
      writerSHA256: WRITER_SHA,
      message: MESSAGE,
      clock: CLOCK,
      toolEffects: 0,
      projection: {
        sourceManifestSHA256: RAW_MANIFEST_SHA,
        sourceArtifact: 13538959063,
        sourceRun: 42290829176,
        sourceAttempt: 1,
        packageRootBase: 'repository',
      },
    });
    const lock = read(join(WRITER, 'package-lock.json'));
    const writer = read(join(WRITER, 'package.json'));
    const versions = { agentfootprint: '14.1.1', footprintjs: '11.0.0', foottrace: '1.11.1' };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[''].dependencies).toEqual(versions);
    expect(writer.dependencies).toEqual(versions);
    expect(Object.keys(manifest.packages).sort()).toEqual(Object.keys(versions).sort());
    for (const [name, version] of Object.entries(versions)) {
      const actual = manifest.packages[name],
        entry = lock.packages[`node_modules/${name}`];
      expect(actual).toMatchObject({
        version,
        resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
        packageRoot: `test/time/fixtures/writer-14.1.1/node_modules/${name}`,
      });
      expect(actual.entrySHA256).toMatch(/^[a-f0-9]{64}$/);
      expect(actual.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
      expect(entry).toMatchObject({
        version,
        resolved: actual.resolved,
        integrity: actual.integrity,
      });
    }
    const checkpoint = read(PAUSE);
    expect(checkpoint.pauseData.awaitingInput.fields).toEqual([manifest.rangeField]);
    expect(manifest.rangeField).toMatchObject({ id: 'f1', format: 'time-range', required: true });
    expect(manifest.rangeField.enum).toEqual(['2026-11-06T16:01:00Z/2026-11-06T18:01:00.001Z']);
  });

  it('resumes the unchanged legacy ISO field in a fresh process, then executes exactly once', () => {
    const resumed = run('resume');
    expect(resumed.before).toEqual({ toolEffects: 0, providerRequests: 0 });
    expect(resumed.legacyRequest?.fields).toEqual([manifest.rangeField]);
    expect(resumed.legacyRequest?.fields.some((field) => field.id.endsWith('-correction'))).toBe(
      false,
    );
    expect(resumed.awaitingInput).toBeUndefined();
    expect(resumed.outcome).toBe('Done.');
    expect(resumed.completed).toBe(1);
    expect(resumed.seen).toEqual([ORIGINAL_EFFECT]);
    expect(resumed.requests).toHaveLength(1); // Only the scripted final answer after the tool.
    expect(resumed.findings.filter((row) => row.kind === 'time-answer')).toEqual([
      expect.objectContaining({ zone: 'UTC', how: 'confirmed' }),
    ]);
    expect(resumed.findings.filter((row) => row.kind === 'time-reply')).toEqual([]);
    expect(hash(readFileSync(PAUSE))).toBe(PAUSE_SHA);
  });

  it('keeps the fresh range field byte-for-byte apart from required, adding only the optional sibling', () => {
    const current = run('fresh');
    expect(current.before).toEqual({ toolEffects: 0, providerRequests: 0 });
    expect(current.completed).toBe(0);
    expect(current.seen).toEqual([]);
    expect(current.requests).toHaveLength(1);
    const fields = current.awaitingInput?.fields;
    expect(fields).toHaveLength(2);
    expect(fields?.[0]).toEqual({ ...manifest.rangeField, required: false });
    expect(fields?.[1]).toEqual({
      id: `${manifest.rangeField.id}-correction`,
      type: 'string',
      required: false,
      description: expect.any(String),
    });
    expect(fields?.[1].description?.trim().length).toBeGreaterThan(0);
    expect(hash(readFileSync(PAUSE))).toBe(PAUSE_SHA);
  });
});
