/**
 * fileObservability — one write at a time, in order, through ONE queue
 * (reported in #223).
 *
 * Before the fix the timer started its write directly while the size trigger
 * and `flush()` chained theirs, so a timed append could overlap another one. A
 * large `fs.promises.appendFile` is several `write()`s, so overlapping appends
 * tore NDJSON lines; they also finished out of order, let `flush()` return
 * while a timed write was still in flight, and let two batches skip a
 * rotation. Every trigger now goes through `outbox.ts`.
 *
 * The filesystems here are fakes on purpose: the faults are interleavings the
 * API permits, and only a fake can hold a write open or split it in two.
 *
 *   P2 Boundary  — `flush()` waits for a write the timer started; an event that
 *                  arrives while `flush()` waits is written by it; `flush()`
 *                  does not chase a producer that keeps emitting
 *   P4 Property  — over many seeds of timer + size + `flush()` triggers against
 *                  a disk that splits each append into two writes: one write
 *                  at a time, every line parses, order is dispatch order; every
 *                  event accepted before a `flush()` is on disk when it
 *                  resolves; the rotation count matches a sequential model and
 *                  no line is split across the two files
 *   P5 Security  — a failed batch (ENOSPC, EACCES) is dropped and reported
 *                  once and later writes continue; a throwing `onError` never
 *                  becomes an unhandled rejection
 *   P7 ROI       — the two reviewed schedules: two timed writes finishing in
 *                  reverse order, and two timed batches skipping a rotation
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileObservability, type FileSinkFs } from '../../src/adapters/observability/file.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { seeded } from '../helpers/seededText.js';

const PATH = '/log/events.ndjson';
const ROTATED = `${PATH}.1`;

// ── Fixtures ─────────────────────────────────────────────────────────

/** Event `seq`, padded with `pad` — `pad` may be multi-byte, so the byte
 *  count that decides rotation is not the character count. */
function numbered(seq: number, pad = ''): AgentfootprintEvent {
  return {
    type: 'agentfootprint.test.numbered',
    payload: { seq, pad },
    meta: { runId: 'run-1' },
  } as unknown as AgentfootprintEvent;
}

/** Split NDJSON into the sequence numbers it holds, counting lines that do
 *  not parse (a torn line) instead of throwing on the first. */
function readLines(content: string | undefined): { seqs: number[]; torn: number } {
  const seqs: number[] = [];
  let torn = 0;
  if (!content) return { seqs, torn };
  const lines = content.split('\n');
  if (lines[lines.length - 1] !== '') torn++; // a file must end on a whole line
  for (const line of lines.slice(0, -1)) {
    try {
      seqs.push((JSON.parse(line) as { payload: { seq: number } }).payload.seq);
    } catch {
      torn++;
    }
  }
  return { seqs, torn };
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Let every queued microtask run (fake timers do not advance them alone). */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** The parts every fake disk shares: the files and the claim-at-construction
 *  calls. */
function fileTable(): { files: Map<string, string>; append(file: string, data: string): void } {
  const files = new Map<string, string>();
  return {
    files,
    append: (file, data) => void files.set(file, (files.get(file) ?? '') + data),
  };
}

interface HeldWrite {
  readonly data: string;
  release(): void;
  fail(err: Error): void;
}

/**
 * A disk whose appends stay open until the test settles them, one by one.
 * `held` lists every append in the order it STARTED; `peak` is the most
 * appends ever open at once.
 */
function heldDisk(): {
  fs: FileSinkFs;
  files: Map<string, string>;
  held: HeldWrite[];
  peak(): number;
  renames(): number;
} {
  const { files, append } = fileTable();
  const held: HeldWrite[] = [];
  let open = 0;
  let peak = 0;
  let renames = 0;
  const fs: FileSinkFs = {
    mkdirSync: () => undefined,
    appendFileSync: append,
    statSync: (file) => ({ size: Buffer.byteLength(files.get(file) ?? '', 'utf8') }),
    appendFile: (file, data) => {
      open++;
      peak = Math.max(peak, open);
      return new Promise<void>((resolve, reject) => {
        held.push({
          data,
          release: () => {
            append(file, data);
            open--;
            resolve();
          },
          fail: (err) => {
            open--;
            reject(err);
          },
        });
      });
    },
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
      renames++;
      return Promise.resolve();
    },
  };
  return { fs, files, held, peak: () => peak, renames: () => renames };
}

/**
 * A disk that writes each append as TWO writes with a pause between them —
 * what a large `appendFile` is — and pauses inside a rename too. Delays come
 * from `next`, so a seed replays exactly. `appendBytes` lists each append's
 * size in the order they started; `peak` counts appends and renames open at
 * once.
 */
function splittingDisk(next: () => number): {
  fs: FileSinkFs;
  files: Map<string, string>;
  appendBytes: number[];
  peak(): number;
  renames(): number;
} {
  const { files, append } = fileTable();
  const appendBytes: number[] = [];
  let open = 0;
  let peak = 0;
  let renames = 0;
  const pause = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 1 + Math.floor(next() * 20)));
  async function transaction(work: () => Promise<void>): Promise<void> {
    open++;
    peak = Math.max(peak, open);
    try {
      await work();
    } finally {
      open--;
    }
  }
  const fs: FileSinkFs = {
    mkdirSync: () => undefined,
    appendFileSync: append,
    statSync: (file) => ({ size: Buffer.byteLength(files.get(file) ?? '', 'utf8') }),
    appendFile: (file, data) =>
      transaction(async () => {
        appendBytes.push(Buffer.byteLength(data, 'utf8'));
        const cut = Math.floor(data.length / 2);
        append(file, data.slice(0, cut));
        await pause();
        append(file, data.slice(cut));
      }),
    rename: (from, to) =>
      transaction(async () => {
        await pause();
        files.set(to, files.get(from) ?? '');
        files.delete(from);
        renames++;
      }),
  };
  return { fs, files, appendBytes, peak: () => peak, renames: () => renames };
}

/** A healthy disk: each append lands whole after `ms` (fake timers). */
function timedDisk(ms: number): { fs: FileSinkFs; files: Map<string, string> } {
  const { files, append } = fileTable();
  const fs: FileSinkFs = {
    mkdirSync: () => undefined,
    appendFileSync: append,
    statSync: (file) => ({ size: Buffer.byteLength(files.get(file) ?? '', 'utf8') }),
    appendFile: (file, data) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          append(file, data);
          resolve();
        }, ms),
      ),
    rename: () => Promise.resolve(),
  };
  return { fs, files };
}

/** The rotation rule run one batch at a time, in order — what the sink must
 *  agree with. */
function modelRenames(appendBytes: readonly number[], ceiling: number): number {
  let onDisk = 0;
  let renames = 0;
  for (const bytes of appendBytes) {
    if (onDisk > 0 && onDisk + bytes > ceiling) {
      renames++;
      onDisk = 0;
    }
    onDisk += bytes;
  }
  return renames;
}

const PADS = ['x', 'é', '漢'] as const;

/**
 * One seeded schedule: `count` events at random gaps, with the timer, the
 * size trigger and un-awaited `flush()` calls all firing into a splitting
 * disk, then a final flush.
 */
async function runSeed(
  seed: number,
  count: number,
  maxBytes?: number,
): Promise<{ disk: ReturnType<typeof splittingDisk>; count: number }> {
  const next = seeded(seed);
  const pick = (n: number): number => Math.floor(next() * n);
  const disk = splittingDisk(next);
  const strat = fileObservability({
    path: PATH,
    _fs: disk.fs,
    flushIntervalMs: 1 + pick(15),
    maxBufferEvents: 1 + pick(5),
    maxBufferBytes: 150 + pick(400),
    ...(maxBytes !== undefined && { maxBytes }),
  });
  const manualFlushes: Array<Promise<void> | void> = [];
  for (let seq = 0; seq < count; seq++) {
    await vi.advanceTimersByTimeAsync(pick(10));
    strat.exportEvent(numbered(seq, PADS[pick(PADS.length)]!.repeat(pick(120))));
    if (next() < 0.1) manualFlushes.push(strat.flush?.());
  }
  const finalFlush = strat.flush?.();
  await vi.runAllTimersAsync();
  await Promise.all([...manualFlushes, finalFlush]);
  strat.stop?.();
  return { disk, count };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('fileObservability serialized writes — P2 boundary', () => {
  it('P2 flush() waits for a write the timer started, even with nothing buffered', async () => {
    vi.useFakeTimers();
    const disk = heldDisk();
    const strat = fileObservability({ path: PATH, _fs: disk.fs, flushIntervalMs: 10 });
    strat.exportEvent(numbered(0));
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(disk.held).toHaveLength(1); // the timer's write is open; the buffer is empty

    let flushed = false;
    const flushing = Promise.resolve(strat.flush?.()).then(() => {
      flushed = true;
    });
    await settle();
    expect(flushed).toBe(false); // a flush that returns now promises a write it cannot see

    disk.held[0]!.release();
    await flushing;
    expect(readLines(disk.files.get(PATH)).seqs).toEqual([0]);
  });

  it('P2 an event that arrives while flush() waits is written by that flush', async () => {
    vi.useFakeTimers();
    const disk = heldDisk();
    const strat = fileObservability({ path: PATH, _fs: disk.fs, flushIntervalMs: 10 });
    strat.exportEvent(numbered(0));
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(disk.held).toHaveLength(1); // the timer's write of 0 is open

    strat.exportEvent(numbered(1)); // buffered when flush() is called
    let flushed = false;
    const flushing = Promise.resolve(strat.flush?.()).then(() => {
      flushed = true;
    });
    strat.exportEvent(numbered(2)); // arrives while flush() waits behind the timer's write
    disk.held[0]!.release();
    await settle();
    expect(disk.held).toHaveLength(2); // flush's own write of 1 and 2

    strat.exportEvent(numbered(3)); // arrives while flush's own write is open
    disk.held[1]!.release();
    await settle();
    expect(flushed).toBe(false); // 3 is still owed
    expect(disk.held).toHaveLength(3);
    disk.held[2]!.release();
    await flushing;

    // Shutdown stops the sink right after flushing. Nothing may be left behind.
    strat.stop?.();
    expect(readLines(disk.files.get(PATH)).seqs).toEqual([0, 1, 2, 3]);
  });

  // Two disks, because the bound can only be broken on one of them. On the fast
  // disk the queue goes idle between writes; on the slow one the size trigger
  // fires mid-write, so a write is always waiting behind the one in flight —
  // the case where a drain that re-read its target would chase the producer.
  it.each([
    { diskMs: 3, disk: 'a fast disk (3 ms): the queue goes idle between writes' },
    { diskMs: 50, disk: 'a slow disk (50 ms): a write always waits behind the one in flight' },
  ])(
    'P2 flush() is bounded under steady traffic on $disk — it does not chase the producer',
    async ({ diskMs }) => {
      vi.useFakeTimers();
      const disk = timedDisk(diskMs); // healthy: every append lands in `diskMs`
      const strat = fileObservability({
        path: PATH,
        _fs: disk.fs,
        maxBufferEvents: 5,
        flushIntervalMs: 10,
      });
      let seq = 0;
      const producer = setInterval(() => strat.exportEvent(numbered(seq++)), 1); // one event per ms
      try {
        await vi.advanceTimersByTimeAsync(30);
        const acceptedAtCall = seq;
        let flushed = false;
        void Promise.resolve(strat.flush?.()).then(() => {
          flushed = true;
        });
        let waited = 0;
        while (!flushed && waited < 2_000) {
          await vi.advanceTimersByTimeAsync(1);
          waited++;
        }
        // What was accepted before the call: at most the write in flight, the
        // one queued behind it, then one sweep — four writes is generous.
        const bound = 4 * diskMs + 20;
        expect(waited, 'fake ms flush() took while the producer kept emitting').toBeLessThanOrEqual(
          bound,
        );
        // …and it still wrote everything accepted before it was called.
        const { seqs } = readLines(disk.files.get(PATH));
        expect(seqs.slice(0, acceptedAtCall)).toEqual(range(acceptedAtCall));
      } finally {
        clearInterval(producer);
        strat.stop?.();
      }
    },
  );
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('fileObservability serialized writes — P4 property', () => {
  it('P4 over 300 seeds: one write at a time, every line parses, dispatch order kept', async () => {
    vi.useFakeTimers();
    for (let seed = 1; seed <= 300; seed++) {
      const { disk, count } = await runSeed(seed, 30);
      const { seqs, torn } = readLines(disk.files.get(PATH));
      expect(disk.peak(), `seed ${seed}: appends open at once`).toBe(1);
      expect(torn, `seed ${seed}: torn lines`).toBe(0);
      expect(seqs, `seed ${seed}: line order`).toEqual(range(count));
    }
  });

  it('P4 over 200 seeds: every event accepted before a flush() is on disk when it resolves', async () => {
    vi.useFakeTimers();
    for (let seed = 1; seed <= 200; seed++) {
      const next = seeded(seed + 10_000);
      const pick = (n: number): number => Math.floor(next() * n);
      const disk = splittingDisk(next);
      const strat = fileObservability({
        path: PATH,
        _fs: disk.fs,
        flushIntervalMs: 1 + pick(15),
        maxBufferEvents: 1 + pick(5),
        maxBufferBytes: 150 + pick(400),
      });
      const misses: string[] = [];
      const flushes: Array<Promise<void>> = [];
      /** Flush now; when it resolves, the first `acceptedAtCall` events must
       *  be whole lines on disk (a later write may be half-way through). */
      const flushExpecting = (acceptedAtCall: number): void => {
        flushes.push(
          Promise.resolve(strat.flush?.()).then(() => {
            const head = readLines(disk.files.get(PATH)).seqs.slice(0, acceptedAtCall);
            if (head.length < acceptedAtCall || head.some((s, i) => s !== i)) {
              misses.push(`flush after ${acceptedAtCall} events resolved with ${head.length}`);
            }
          }),
        );
      };
      // Some seeds leave the disk idle between events, some keep it busy.
      const maxGap = 5 + pick(30);
      for (let seq = 0; seq < 30; seq++) {
        await vi.advanceTimersByTimeAsync(pick(maxGap));
        // A flush long after the last event: what was accepted is waiting,
        // in a write, or already written.
        if (seq > 0 && next() < 0.2) flushExpecting(seq);
        strat.exportEvent(numbered(seq, 'x'.repeat(pick(120))));
        // A flush just after a size trigger started its write: everything
        // accepted may be in flight with nothing left waiting.
        if (next() < 0.2) {
          await settle();
          flushExpecting(seq + 1);
        }
      }
      await vi.runAllTimersAsync();
      await Promise.all(flushes);
      strat.stop?.();
      expect(misses, `seed ${seed}`).toEqual([]);
    }
  });

  it('P4 over 300 seeds: rotation matches the one-batch-at-a-time model, no line split across files', async () => {
    vi.useFakeTimers();
    for (let seed = 1; seed <= 300; seed++) {
      const ceiling = 150 + (seed % 7) * 60;
      const { disk, count } = await runSeed(seed, 30, ceiling);
      const active = readLines(disk.files.get(PATH));
      const rotated = readLines(disk.files.get(ROTATED));
      expect(disk.peak(), `seed ${seed}: fs calls open at once`).toBe(1);
      expect(active.torn + rotated.torn, `seed ${seed}: torn lines`).toBe(0);
      expect(disk.renames(), `seed ${seed}: rotations`).toBe(
        modelRenames(disk.appendBytes, ceiling),
      );
      // ONE generation: `.1` is the generation just before the active file,
      // and the two together end at the newest event.
      const survivors = [...rotated.seqs, ...active.seqs];
      expect(survivors, `seed ${seed}: surviving lines`).toEqual(
        range(count).slice(count - survivors.length),
      );
    }
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('fileObservability serialized writes — P5 security', () => {
  it.each(['ENOSPC', 'EACCES'])(
    'P5 a %s batch is dropped and reported once; the batch queued behind it is written',
    async (code) => {
      vi.useFakeTimers();
      const disk = heldDisk();
      const errors: Error[] = [];
      const strat = fileObservability({
        path: PATH,
        _fs: disk.fs,
        flushIntervalMs: 10,
        maxBufferEvents: 2,
        onError: (err) => errors.push(err),
      });
      strat.exportEvent(numbered(0));
      await vi.advanceTimersByTimeAsync(10);
      await settle();
      strat.exportEvent(numbered(1));
      strat.exportEvent(numbered(2)); // size trigger, queued behind the timer's write
      await settle();
      expect(disk.held).toHaveLength(1); // queued, not started beside it

      disk.held[0]!.fail(Object.assign(new Error(`${code}: write refused`), { code }));
      await settle();
      expect(disk.held).toHaveLength(2); // the next batch started; the failed one did not retry
      disk.held[1]!.release();
      await strat.flush?.();

      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/1 event\(s\) dropped writing to '\/log\/events\.ndjson'/);
      expect(errors[0]?.message).toContain(code);
      expect(readLines(disk.files.get(PATH)).seqs).toEqual([1, 2]);

      // …and the sink keeps working after it.
      strat.exportEvent(numbered(3));
      const flushing = strat.flush?.();
      await settle();
      disk.held[2]!.release();
      await flushing;
      expect(readLines(disk.files.get(PATH)).seqs).toEqual([1, 2, 3]);
      expect(errors).toHaveLength(1);
    },
  );

  it('P5 a throwing onError never becomes an unhandled rejection, on the timer or in flush()', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const disk = heldDisk();
      const strat = fileObservability({
        path: PATH,
        _fs: disk.fs,
        flushIntervalMs: 1,
        onError: () => {
          throw new Error('the consumer hook broke');
        },
      });
      // The timer path.
      strat.exportEvent(numbered(0));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(disk.held).toHaveLength(1);
      disk.held[0]!.fail(new Error('ENOSPC: no space left on device'));
      await new Promise((resolve) => setTimeout(resolve, 20));

      // The flush() path.
      strat.exportEvent(numbered(1));
      const flushing = strat.flush?.();
      await settle();
      disk.held[1]!.fail(new Error('EACCES: permission denied'));
      await expect(flushing).resolves.toBeUndefined();
      strat.stop?.();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
      // Neither failure vanished: the console fallback says both things.
      const said = consoleError.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(said).toMatch(
        /dropped writing.*ENOSPC.*the onError hook threw: the consumer hook broke/,
      );
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('fileObservability serialized writes — P7 ROI (the reviewed schedules)', () => {
  it('P7 two timed writes finishing in reverse order still land in dispatch order', async () => {
    vi.useFakeTimers();
    const disk = heldDisk();
    const strat = fileObservability({ path: PATH, _fs: disk.fs, flushIntervalMs: 10 });
    strat.exportEvent(numbered(0));
    await vi.advanceTimersByTimeAsync(10);
    strat.exportEvent(numbered(1));
    await vi.advanceTimersByTimeAsync(10);
    await settle();

    // Finish the NEWEST open write first, every time, until none is left.
    const flushing = strat.flush?.();
    for (let done = 0; done < disk.held.length; ) {
      const open = disk.held.slice(done);
      for (const write of open.reverse()) write.release();
      done += open.length;
      await settle();
    }
    await flushing;

    expect(disk.peak()).toBe(1);
    expect(readLines(disk.files.get(PATH)).seqs).toEqual([0, 1]);
  });

  it('P7 a size-triggered write waits for the timed write already open', async () => {
    vi.useFakeTimers();
    const disk = heldDisk();
    const strat = fileObservability({
      path: PATH,
      _fs: disk.fs,
      flushIntervalMs: 10,
      maxBufferEvents: 2,
    });
    strat.exportEvent(numbered(0));
    await vi.advanceTimersByTimeAsync(10);
    strat.exportEvent(numbered(1));
    strat.exportEvent(numbered(2)); // crosses the size trigger
    await settle();
    expect(disk.held).toHaveLength(1);

    disk.held[0]!.release();
    await settle();
    disk.held[1]!.release();
    await strat.flush?.();
    expect(disk.peak()).toBe(1);
    expect(readLines(disk.files.get(PATH)).seqs).toEqual([0, 1, 2]);
  });

  it('P7 two timed batches that together cross the ceiling rotate once, not never', async () => {
    vi.useFakeTimers();
    const disk = heldDisk();
    const lineBytes = Buffer.byteLength(`${JSON.stringify(numbered(0))}\n`, 'utf8');
    const strat = fileObservability({
      path: PATH,
      _fs: disk.fs,
      flushIntervalMs: 10,
      maxBytes: lineBytes + 1, // one line fits, two do not
    });
    strat.exportEvent(numbered(0));
    await vi.advanceTimersByTimeAsync(10);
    strat.exportEvent(numbered(1));
    await vi.advanceTimersByTimeAsync(10);
    await settle();

    const flushing = strat.flush?.();
    for (let done = 0; done < disk.held.length; done++) {
      disk.held[done]!.release();
      await settle();
    }
    await flushing;

    expect(disk.renames()).toBe(1);
    expect(readLines(disk.files.get(ROTATED)).seqs).toEqual([0]);
    expect(readLines(disk.files.get(PATH)).seqs).toEqual([1]);
  });
});
