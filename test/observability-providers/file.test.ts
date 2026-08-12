/**
 * fileObservability — 7-pattern tests.
 *
 *   P1 Unit         — name / capabilities / relevantEventTypes pass-through
 *   P2 Boundary     — flush() writes NDJSON; flush after stop() still ships;
 *                     an empty buffer is a no-op
 *   P3 Scenario     — a real run's worth of events lands on a real disk, one
 *                     JSON line per event, in dispatch order, same envelope
 *                     CloudWatch ships
 *   P4 Property     — size + timer triggers; rotation is ONE generation and
 *                     replaces a previous `.1`
 *   P5 Security     — unwritable path refused at construction (teaching); the
 *                     hot path never throws; write failures reach onError and
 *                     are dropped, never requeued
 *   P6 Performance  — exportEvent is sync and scales linearly (no disk in it)
 *   P7 ROI          — the same file is readable by `JSON.parse` per line, and
 *                     the strategy is attachable through the real dispatcher
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fileObservability,
  type FileObservabilityOptions,
  type FileSinkFs,
} from '../../src/adapters/observability/file.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { expectScalesLinearly } from '../helpers/perf.js';
import { settlesWithin } from '../helpers/settles.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const dirs: string[] = [];

function tempFile(name = 'events.ndjson'): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-file-obs-'));
  dirs.push(dir);
  return join(dir, name);
}

function event(type: string, payload: Record<string, unknown> = {}): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: { runId: 'run-1', sessionId: 'sess-1' },
  } as unknown as AgentfootprintEvent;
}

function linesOf(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

/** An in-memory {@link FileSinkFs}: the seam that lets rotation and write
 *  failures be asserted without a real disk (or a real full one). */
function memoryFs(): {
  fs: FileSinkFs;
  files: Map<string, string>;
  failNextAppend(err: Error): void;
  appends(): number;
} {
  const files = new Map<string, string>();
  let pendingFailure: Error | undefined;
  let appendCount = 0;
  return {
    files,
    appends: () => appendCount,
    failNextAppend(err) {
      pendingFailure = err;
    },
    fs: {
      mkdirSync: () => undefined,
      appendFileSync: (file, data) => {
        files.set(file, (files.get(file) ?? '') + data);
      },
      statSync: (file) => ({ size: Buffer.byteLength(files.get(file) ?? '', 'utf8') }),
      appendFile: (file, data) => {
        appendCount++;
        if (pendingFailure) {
          const err = pendingFailure;
          pendingFailure = undefined;
          return Promise.reject(err);
        }
        files.set(file, (files.get(file) ?? '') + data);
        return Promise.resolve();
      },
      rename: (from, to) => {
        files.set(to, files.get(from) ?? '');
        files.delete(from);
        return Promise.resolve();
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('fileObservability — P1 unit', () => {
  it('P1 name is `file` and it declares events + logs', () => {
    const strat = fileObservability({ path: tempFile(), flushIntervalMs: 0 });
    expect(strat.name).toBe('file');
    expect(strat.capabilities.events).toBe(true);
    expect(strat.capabilities.logs).toBe(true);
  });

  it('P1 `eventTypes` becomes relevantEventTypes (so attach filters for us)', () => {
    const narrowed = fileObservability({
      path: tempFile(),
      flushIntervalMs: 0,
      eventTypes: ['agentfootprint.agent.turn_start'] as never,
    });
    expect(narrowed.relevantEventTypes).toEqual(['agentfootprint.agent.turn_start']);
    // Omitted means NO filter — the dispatcher forwards everything the tier
    // allows. An empty array would mean "forward nothing", a different fact.
    const open = fileObservability({ path: tempFile(), flushIntervalMs: 0 });
    expect(open.relevantEventTypes).toBeUndefined();
  });

  it('P1 the file is claimed at construction, before any event', () => {
    const path = tempFile();
    fileObservability({ path, flushIntervalMs: 0 });
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBe(0);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('fileObservability — P2 boundary', () => {
  it('P2 flush() writes one NDJSON line per event', async () => {
    const path = tempFile();
    const strat = fileObservability({ path, flushIntervalMs: 0 });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();

    const lines = linesOf(path);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).type).toBe('agentfootprint.agent.turn_start');
    expect(JSON.parse(lines[1]!).type).toBe('agentfootprint.agent.turn_end');
  });

  it('P2 flush() after stop() still writes what was accepted, and settles', async () => {
    // Injected fs on purpose: the fault being guarded (8.11.1) is a drain loop
    // that spins on already-resolved promises, and only a microtask-resolving
    // sink can tell that apart from a slow disk.
    const mem = memoryFs();
    const path = '/log/events.ndjson';
    const strat = fileObservability({ path, flushIntervalMs: 0, _fs: mem.fs });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.stop?.();
    // stop() stops ACCEPTING; it does not authorise discarding what was already
    // accepted — and a drain that cannot progress must return rather than spin.
    await settlesWithin(Promise.resolve(strat.flush?.()), 'flush() after stop()');
    expect((mem.files.get(path) ?? '').trim().split('\n')).toHaveLength(1);

    // …and events after stop() are dropped.
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    expect((mem.files.get(path) ?? '').trim().split('\n')).toHaveLength(1);
  });

  it('P2 flush() with nothing buffered writes nothing', async () => {
    const path = tempFile();
    const strat = fileObservability({ path, flushIntervalMs: 0 });
    await strat.flush?.();
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  it('P2 a restart appends to the existing file rather than truncating it', async () => {
    const path = tempFile();
    const first = fileObservability({ path, flushIntervalMs: 0 });
    first.exportEvent(event('agentfootprint.agent.turn_start'));
    await first.flush?.();
    first.stop?.();

    const second = fileObservability({ path, flushIntervalMs: 0 });
    second.exportEvent(event('agentfootprint.agent.turn_end'));
    await second.flush?.();

    expect(linesOf(path)).toHaveLength(2);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('fileObservability — P3 scenario', () => {
  it('P3 a run’s events land in dispatch order, in the CloudWatch envelope', async () => {
    const path = tempFile();
    const strat = fileObservability({ path, flushIntervalMs: 0, maxBufferEvents: 3 });

    const types = [
      'agentfootprint.agent.turn_start',
      'agentfootprint.stream.tool_start',
      'agentfootprint.stream.tool_end',
      'agentfootprint.agent.iteration_end',
      'agentfootprint.agent.turn_end',
    ];
    for (const [i, type] of types.entries()) strat.exportEvent(event(type, { seq: i }));
    await strat.flush?.();

    const parsed = linesOf(path).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.map((p) => p.type)).toEqual(types);
    expect(parsed.map((p) => (p.payload as { seq: number }).seq)).toEqual([0, 1, 2, 3, 4]);
    // The envelope is the whole event — the same bytes cloudwatchObservability
    // puts in a log event, which is what makes one query read both.
    expect(parsed[0]).toEqual({
      type: 'agentfootprint.agent.turn_start',
      payload: { seq: 0 },
      meta: { runId: 'run-1', sessionId: 'sess-1' },
    });
  });

  it('P3 the parent directory is created for a path that does not exist yet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'af-file-obs-'));
    dirs.push(root);
    const path = join(root, 'nested', 'deeper', 'events.ndjson');
    const strat = fileObservability({ path, flushIntervalMs: 0 });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    await strat.flush?.();
    expect(linesOf(path)).toHaveLength(1);
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('fileObservability — P4 property', () => {
  it('P4 the event-count trigger writes without anyone calling flush()', async () => {
    const mem = memoryFs();
    const strat = fileObservability({
      path: '/log/events.ndjson',
      flushIntervalMs: 0,
      maxBufferEvents: 2,
      _fs: mem.fs,
    });
    strat.exportEvent(event('a'));
    expect(mem.appends()).toBe(0);
    strat.exportEvent(event('b')); // crosses the ceiling
    await strat.flush?.();
    expect(mem.files.get('/log/events.ndjson')?.trim().split('\n')).toHaveLength(2);
  });

  it('P4 the byte trigger fires on a big payload before the count would', async () => {
    const mem = memoryFs();
    const strat = fileObservability({
      path: '/log/events.ndjson',
      flushIntervalMs: 0,
      maxBufferEvents: 1000,
      maxBufferBytes: 200,
      _fs: mem.fs,
    });
    strat.exportEvent(event('big', { blob: 'x'.repeat(500) }));
    await strat.flush?.();
    expect(mem.appends()).toBeGreaterThan(0);
  });

  it('P4 the timer writes when traffic is sparse', async () => {
    vi.useFakeTimers();
    const mem = memoryFs();
    const strat = fileObservability({
      path: '/log/events.ndjson',
      flushIntervalMs: 50,
      maxBufferEvents: 1000,
      _fs: mem.fs,
    });
    strat.exportEvent(event('lonely'));
    expect(mem.appends()).toBe(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(mem.appends()).toBe(1);
    strat.stop?.();
  });

  it('P4 rotation is ONE generation and replaces a previous `.1`', async () => {
    const mem = memoryFs();
    const path = '/log/events.ndjson';
    const strat = fileObservability({
      path,
      flushIntervalMs: 0,
      maxBytes: 120,
      _fs: mem.fs,
    });

    // Three flushes, each bigger than a third of the ceiling: at least two
    // rotations, so the SECOND one has to overwrite the first `.1`.
    for (let i = 0; i < 3; i++) {
      strat.exportEvent(event(`agentfootprint.round.${i}`, { pad: 'y'.repeat(80) }));
      await strat.flush?.();
    }

    expect(mem.files.has(`${path}.1`)).toBe(true);
    // ONE generation, deliberately: no `.2` is ever created.
    expect(mem.files.has(`${path}.2`)).toBe(false);
    // The surviving `.1` is the MOST RECENT rotation, not the first.
    expect(mem.files.get(`${path}.1`)).toContain('agentfootprint.round.1');
    expect(mem.files.get(`${path}.1`)).not.toContain('agentfootprint.round.0');
  });

  it('P4 without maxBytes nothing is ever renamed (logrotate owns the file)', async () => {
    const mem = memoryFs();
    const path = '/log/events.ndjson';
    const strat = fileObservability({ path, flushIntervalMs: 0, _fs: mem.fs });
    for (let i = 0; i < 20; i++) {
      strat.exportEvent(event('bulk', { pad: 'z'.repeat(500) }));
      await strat.flush?.();
    }
    expect(mem.files.has(`${path}.1`)).toBe(false);
  });

  it('P4 a single batch larger than the whole ceiling is still written', async () => {
    const mem = memoryFs();
    const path = '/log/events.ndjson';
    const strat = fileObservability({ path, flushIntervalMs: 0, maxBytes: 50, _fs: mem.fs });
    strat.exportEvent(event('huge', { pad: 'q'.repeat(400) }));
    await strat.flush?.();
    // Truncating a run's telemetry to fit a safety dial would be the worse bug.
    expect(mem.files.get(path)).toContain('huge');
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('fileObservability — P5 security', () => {
  it('P5 a missing path is refused at construction, teachingly', () => {
    expect(() => fileObservability({ path: '' })).toThrow(/`path` is required/);
    expect(() => fileObservability({ path: '   ' })).toThrow(/events\.ndjson/);
  });

  it('P5 a nonsense maxBytes is refused, and names the no-rotation default', () => {
    expect(() => fileObservability({ path: tempFile(), maxBytes: 0 })).toThrow(
      /positive number of bytes/,
    );
    expect(() => fileObservability({ path: tempFile(), maxBytes: -1 })).toThrow(/logrotate/);
  });

  it('P5 an unwritable path is refused at construction, naming the path', () => {
    const root = mkdtempSync(join(tmpdir(), 'af-file-obs-'));
    dirs.push(root);
    // A DIRECTORY where the log file should be — the ordinary shape of "that
    // path is not writable", and portable (a root-run CI ignores chmod).
    const path = join(root, 'events.ndjson');
    mkdirSync(path);
    expect(() => fileObservability({ path })).toThrow(new RegExp(`cannot write '${path}'`));
    expect(() => fileObservability({ path })).toThrow(/refuses to start rather than/);
  });

  it('P5 the hot path never throws — an unserializable event is reported, not raised', () => {
    const errors: Error[] = [];
    const strat = fileObservability({
      path: tempFile(),
      flushIntervalMs: 0,
      onError: (err) => errors.push(err),
    });
    const cyclic: Record<string, unknown> = { type: 'agentfootprint.cycle' };
    cyclic.self = cyclic;
    expect(() => strat.exportEvent(cyclic as unknown as AgentfootprintEvent)).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/could not be serialized/);
  });

  it('P5 a write failure reaches onError and the batch is dropped, never requeued', async () => {
    const mem = memoryFs();
    const errors: Error[] = [];
    const strat = fileObservability({
      path: '/log/events.ndjson',
      flushIntervalMs: 0,
      onError: (err) => errors.push(err),
      _fs: mem.fs,
    });
    mem.failNextAppend(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }));
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    await strat.flush?.();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/1 event\(s\) dropped writing to '\/log\/events\.ndjson'/);
    expect(errors[0]?.message).toMatch(/no space left on device/);

    // A disk that has been full for an hour must not grow the buffer: the next
    // flush writes only what arrived after the failure.
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    await strat.flush?.();
    const written = mem.files.get('/log/events.ndjson') ?? '';
    expect(written).toContain('turn_end');
    expect(written).not.toContain('turn_start');
  });

  it('P5 `_onError` assigned AFTER construction still receives write failures', async () => {
    const mem = memoryFs();
    const strat = fileObservability({
      path: '/log/events.ndjson',
      flushIntervalMs: 0,
      _fs: mem.fs,
    });
    const seen: Error[] = [];
    strat._onError = (err) => seen.push(err);
    mem.failNextAppend(new Error('EACCES'));
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    await strat.flush?.();
    expect(seen).toHaveLength(1);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('fileObservability — P6 performance', () => {
  it('P6 exportEvent is sync and scales linearly (no disk on the hot path)', async () => {
    const mem = memoryFs();
    const strat = fileObservability({
      path: '/log/events.ndjson',
      flushIntervalMs: 0,
      maxBufferEvents: 1_000_000,
      maxBufferBytes: 1_000_000_000,
      _fs: mem.fs,
    });
    const e = event('agentfootprint.stream.token', { text: 'hello world' });
    await expectScalesLinearly({
      small: () => {
        for (let i = 0; i < 2_000; i++) strat.exportEvent(e);
      },
      large: () => {
        for (let i = 0; i < 20_000; i++) strat.exportEvent(e);
      },
      scale: 10,
      why: 'buffering an event must be O(1): serialize, push, count bytes',
    });
    // Whatever the sampler repeated, the write count stayed a rounding error
    // beside the event count — the disk is not on the hot path.
    expect(mem.appends()).toBeLessThan(50);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('fileObservability — P7 ROI', () => {
  it('P7 the file is NDJSON: every line parses on its own', async () => {
    const path = tempFile();
    const strat = fileObservability({ path, flushIntervalMs: 0, maxBufferEvents: 2 });
    for (let i = 0; i < 7; i++) strat.exportEvent(event('agentfootprint.stream.token', { i }));
    await strat.flush?.();

    const raw = readFileSync(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(7);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines.map((l) => (JSON.parse(l) as { payload: { i: number } }).payload.i)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('P7 the options type is assignable from a plain literal (no vendor types)', () => {
    const opts: FileObservabilityOptions = {
      path: tempFile(),
      maxBytes: 1024,
      flushIntervalMs: 0,
    };
    expect(fileObservability(opts).name).toBe('file');
  });
});
