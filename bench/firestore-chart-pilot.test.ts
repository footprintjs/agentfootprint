/**
 * Operation-only cost of the Firestore chart pilot, against the existing SDK
 * double. This is not a network benchmark. Run this exact harness on the base
 * and proposed source, using the same Node installation and machine.
 *
 * The task-local Vitest config includes only this file; the ordinary suite
 * excludes bench/. No JSON is written unless AF_FIRESTORE_BENCH_OUT names it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { firestoreSessions } from '../src/adapters/hosting/firestoreSessions/index.js';
import type { CheckpointEnvelope } from '../src/hosting/types.js';
import { fakeFirestore } from '../test/hosting/firestoreDouble.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CALLS_PER_OPERATION = 1_000;
const MEASURED_ROUNDS = 5;
// 50 saves + 50 loads = 100 warmup operations, on a separate fresh store.
const WARMUP_CALLS_PER_OPERATION = 50;
const ENVELOPE: CheckpointEnvelope = {
  format: 'conversation-v1',
  savedAt: 1_700_000_000_000,
  data: {
    version: 1,
    runId: 'firestore-bench-run',
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'a fixed reply' },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: 'hello' },
    checkpointedAt: 1_700_000_000_000,
  },
};
const ENVELOPE_JSON = JSON.stringify(ENVELOPE);

function implementationFiles(): string[] {
  const base = join(ROOT, 'src/adapters/hosting/firestoreSessions');
  const files: string[] = [];
  if (existsSync(`${base}.ts`)) files.push(`${base}.ts`);
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) files.push(path);
    }
  }
  if (existsSync(base)) walk(base);
  if (files.length === 0) throw new Error('No Firestore implementation was found to identify.');
  return files.sort();
}

function sourceIdentity() {
  const files = implementationFiles();
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(relative(ROOT, path)).update('\0').update(readFileSync(path)).update('\0');
  }
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    sourceSha256: hash.digest('hex'),
    files: files.map((path) => relative(ROOT, path)),
    sourceDirty:
      execFileSync('git', ['status', '--porcelain', '--', ...files], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim() !== '',
  };
}

interface Round {
  round: number;
  persistMs: number;
  hydrateMs: number;
  persistUsPerCall: number;
  hydrateUsPerCall: number;
  transactionCalls: number;
  documentReadCalls: number;
}

async function exercise(round: number, calls: number): Promise<Round> {
  const fake = fakeFirestore();
  // Module loading, chart construction and store construction are outside
  // operation timing. All five measured rounds get their own empty store.
  const sessions = firestoreSessions({ _sdk: fake.sdk });
  const ids = Array.from({ length: calls }, (_, i) => `bench-session-${i}`);
  const loaded: Array<CheckpointEnvelope | undefined> = [];
  try {
    const persistStart = performance.now();
    for (const id of ids) await sessions.persist(id, ENVELOPE);
    const persistMs = performance.now() - persistStart;
    const hydrateStart = performance.now();
    for (const id of ids) loaded.push(await sessions.hydrate(id));
    const hydrateMs = performance.now() - hydrateStart;

    // Correctness and SDK-effect assertions stay OUTSIDE both timed loops.
    expect(loaded).toHaveLength(calls);
    for (const value of loaded) expect(value).toEqual(ENVELOPE);
    expect(fake.store.size).toBe(calls);
    expect(JSON.stringify(ENVELOPE)).toBe(ENVELOPE_JSON);
    const transactionCalls = fake.calls.filter(
      (call) => call === 'Firestore.runTransaction',
    ).length;
    const documentReadCalls = fake.calls.filter((call) => call === 'DocumentReference.get').length;
    expect(transactionCalls).toBe(calls);
    expect(documentReadCalls).toBe(calls);
    return {
      round,
      persistMs,
      hydrateMs,
      persistUsPerCall: (persistMs * 1_000) / calls,
      hydrateUsPerCall: (hydrateMs * 1_000) / calls,
      transactionCalls,
      documentReadCalls,
    };
  } finally {
    await sessions.close();
  }
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? 0;
}

describe('Firestore chart pilot cost — fake backend, no network', () => {
  it('measures 1000 saves and loads without putting assertions in their timed loops', async () => {
    const source = sourceIdentity();
    await exercise(0, WARMUP_CALLS_PER_OPERATION);
    const rounds: Round[] = [];
    for (let round = 1; round <= MEASURED_ROUNDS; round++)
      rounds.push(await exercise(round, CALLS_PER_OPERATION));
    const after = sourceIdentity();
    expect(after, 'implementation changed while the benchmark was running').toEqual(source);
    const persistMs = median(rounds.map((round) => round.persistMs));
    const hydrateMs = median(rounds.map((round) => round.hydrateMs));
    const result = {
      schema: 'firestore-chart-pilot-v1',
      label: process.env.AF_FIRESTORE_BENCH_LABEL ?? 'unlabelled',
      measuredAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: platform(),
        release: release(),
        architecture: process.arch,
        cpu: cpus()[0]?.model ?? 'unknown',
        cpuCount: cpus().length,
      },
      source,
      harnessSha256: createHash('sha256')
        .update(readFileSync(fileURLToPath(import.meta.url)))
        .digest('hex'),
      fixture: {
        serializedBytes: Buffer.byteLength(ENVELOPE_JSON, 'utf8'),
        sha256: createHash('sha256').update(ENVELOPE_JSON).digest('hex'),
      },
      protocol: {
        fakeBackend: true,
        networkCalls: 0,
        storeConstructionIncluded: false,
        warmupOperations: WARMUP_CALLS_PER_OPERATION * 2,
        warmupSaves: WARMUP_CALLS_PER_OPERATION,
        warmupLoads: WARMUP_CALLS_PER_OPERATION,
        measuredRounds: MEASURED_ROUNDS,
        savesPerRound: CALLS_PER_OPERATION,
        loadsPerRound: CALLS_PER_OPERATION,
        serial: true,
        assertionsTimed: false,
      },
      rounds,
      median: {
        persistMs,
        hydrateMs,
        persistUsPerCall: (persistMs * 1_000) / CALLS_PER_OPERATION,
        hydrateUsPerCall: (hydrateMs * 1_000) / CALLS_PER_OPERATION,
      },
      limit: 'In-process SDK double only; this does not measure service or network latency.',
    };
    const json = JSON.stringify(result, null, 2) + '\n';
    console.log(json);
    const output = process.env.AF_FIRESTORE_BENCH_OUT;
    if (output !== undefined && output !== '') {
      const path = resolve(output);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, json);
    }
  }, 110_000);
});
