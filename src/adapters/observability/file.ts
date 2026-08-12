/**
 * fileObservability — the typed event stream, one JSON line per event, in a
 * local file.
 *
 * The sink for the shop that has no collector. Every other adapter in this
 * folder ships somewhere: CloudWatch, X-Ray, an OTLP endpoint. A great many
 * on-premises deployments have none of those — they have a directory, a log
 * shipper (Filebeat, Fluent Bit, Vector, `promtail`, `journald`, or a person
 * with `grep`), and a rule that nothing leaves the network. NDJSON on disk is
 * the format all of those already read, so the sink is the file.
 *
 * Zero dependencies: `node:fs`, lazily required at construction so merely
 * importing `agentfootprint/observe` stays browser-safe (this factory is
 * Node-only; calling it in a browser throws by name).
 *
 * ## The line
 *
 * One `JSON.stringify(event)` per line, newline-terminated, appended in
 * dispatch order — the SAME envelope `cloudwatchObservability` puts in a log
 * event, so a query written against one reads the other:
 *
 * ```jsonl
 * {"type":"agentfootprint.agent.turn_start","payload":{…},"meta":{"runId":"…","sessionId":"…"}}
 * {"type":"agentfootprint.stream.tool_end","payload":{…},"meta":{…}}
 * ```
 *
 * Nothing is summarized, bounded or redacted on the way out. **A payload that
 * must not be on that disk must not reach this strategy** — narrow it with
 * `eventTypes` / `tier` / `sampleRate`, or apply a footprintjs
 * `RedactionPolicy` upstream, exactly as with every other sink. (For a bounded
 * record by construction, `auditExport({ payloadMode: 'bounded' })` is the
 * adapter that does that job.)
 *
 * ## Buffered, not synchronous
 *
 * `exportEvent` is sync and never touches the disk: it serializes, buffers, and
 * returns. Batches are appended asynchronously on a size trigger
 * (`maxBufferEvents` / `maxBufferBytes`), on a timer (`flushIntervalMs`), and on
 * `flush()`. A hard kill therefore loses at most the buffer — the price of not
 * making telemetry a term in agent-loop latency. Call `flush()` (or
 * `agent.shutdown()`, which does) at process end; see the 8.12.0 lifecycle laws
 * on {@link BaseStrategy.flush}.
 *
 * ## Rotation is ONE generation, and that is deliberate
 *
 * With `maxBytes` set, a batch that would push the file past the ceiling first
 * renames it to `<path>.1` — **replacing any previous `.1`** — and starts a
 * fresh file. That is the whole policy. There is no `.2`, no compression, no
 * time-based schedule, no cross-process coordination (two processes writing one
 * file each keep their own byte count and will both rotate it). It exists so an
 * unattended agent cannot fill a disk, and for nothing else: **retention is a
 * log-management daemon's job**, and `logrotate` with `copytruncate`, Fluent Bit,
 * or a systemd timer will do it properly. Omit `maxBytes` — the default — and
 * this adapter never renames anything, which is the right choice when a real
 * rotator already owns the file.
 *
 * @example
 * ```ts
 * import { fileObservability } from 'agentfootprint/observe';
 *
 * const telemetry = agent.enable.observability({
 *   strategy: fileObservability({
 *     path: '/var/log/agentfootprint/events.ndjson',
 *     maxBytes: 64 * 1024 * 1024,   // safety ceiling; logrotate owns retention
 *   }),
 * });
 *
 * // … run …
 * await agent.shutdown();           // flushes + stops everything enabled
 * ```
 */

import type { AgentfootprintEvent, AgentfootprintEventType } from '../../events/registry.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { ObservabilityStrategy } from '../../strategies/types.js';

import { rateLimitedConsoleSink } from './deliveryErrors.js';

// ─── Public options ──────────────────────────────────────────────────

export interface FileObservabilityOptions {
  /** Absolute or relative path to the NDJSON file. **Required.** Its parent
   *  directories are created (`recursive`) and the file itself is claimed at
   *  construction, so an unwritable path fails where you wrote it rather than
   *  at the first event — the only moment a caller is still watching. */
  readonly path: string;
  /** Rotation ceiling in bytes. Omitted → **never rotates** (the right choice
   *  when `logrotate` or a shipper already owns the file). Set → a batch that
   *  would cross the ceiling first renames the file to `<path>.1`, replacing
   *  any previous `.1`, and starts fresh. ONE generation, no compression, no
   *  cross-process coordination — see the note in this module's docstring. */
  readonly maxBytes?: number;
  /** Max events buffered before a forced append. Default 100. */
  readonly maxBufferEvents?: number;
  /** Max buffered payload bytes (UTF-8) before a forced append. Default 65536
   *  (64 KB) — a local write is cheap, so this is far larger than the network
   *  adapters' 10 KB. */
  readonly maxBufferBytes?: number;
  /** Forced-append interval when traffic is sparse, in ms. Default 1000.
   *  `0` disables the timer — only size triggers and `flush()` write. */
  readonly flushIntervalMs?: number;
  /** Narrow what lands on the disk. Becomes the strategy's
   *  {@link ObservabilityStrategy.relevantEventTypes}, so the dispatcher does
   *  not even forward the rest — the filter costs nothing at the hot path.
   *  Omitted → every event the `tier` lets through is written. */
  readonly eventTypes?: readonly AgentfootprintEventType[];
  /**
   * Where delivery failures go — a full disk, a revoked permission, a path
   * whose directory was removed under a long-running process.
   *
   * Same law as the network adapters (8.11.0): **telemetry that fails
   * invisibly is indistinguishable from telemetry that works.** Unhandled,
   * failures reach a rate-limited `console.error`. The batch that failed is
   * dropped, never requeued, so a disk that has been full for an hour cannot
   * grow the buffer without bound.
   */
  readonly onError?: (error: Error, event?: AgentfootprintEvent) => void;
  /** Test seam — inject a filesystem. Bypasses `node:fs` entirely, which is
   *  also what lets the rotation policy be asserted without a real disk. */
  readonly _fs?: FileSinkFs;
}

/**
 * The slice of the filesystem this adapter touches — five calls, named by what
 * the adapter uses them FOR rather than by their `node:fs` signatures.
 *
 * Sync members run once, at construction; the append path is async so the agent
 * loop never waits on a disk.
 */
export interface FileSinkFs {
  /** Create the log file's parent directory chain. */
  mkdirSync(dir: string, options: { readonly recursive: boolean }): void;
  /** Claim the file at construction. This is the writability refusal: an
   *  unwritable path throws HERE, with the caller still on the stack. */
  appendFileSync(file: string, data: string): void;
  /** Current size, so the rotation counter starts from what is already there
   *  rather than from zero on every restart. */
  statSync(file: string): { readonly size: number };
  /** Append one batch of NDJSON lines. */
  appendFile(file: string, data: string): Promise<void>;
  /** Rotate: `<path>` → `<path>.1`, replacing any previous `.1`. */
  rename(from: string, to: string): Promise<void>;
}

// ─── Public factory ──────────────────────────────────────────────────

/**
 * NDJSON-to-a-local-file observability strategy. See
 * {@link FileObservabilityOptions} for the per-option contract, and this
 * module's docstring for the rotation policy and what is NOT bounded.
 */
export function fileObservability(opts: FileObservabilityOptions): ObservabilityStrategy {
  const strategyName = 'file';

  if (!opts.path || typeof opts.path !== 'string' || opts.path.trim() === '') {
    throw new TypeError(
      `[${strategyName}Observability] \`path\` is required — the file this sink writes. ` +
        `Pass one, e.g. '/var/log/agentfootprint/events.ndjson'. There is no default: ` +
        `where a run's telemetry lands on your disk is not a decision this library makes.`,
    );
  }
  if (opts.maxBytes !== undefined && !(opts.maxBytes > 0)) {
    throw new TypeError(
      `[${strategyName}Observability] \`maxBytes\` must be a positive number of bytes ` +
        `(got ${String(opts.maxBytes)}). Omit it for no rotation at all, which is the ` +
        `right choice when logrotate or a log shipper already owns '${opts.path}'.`,
    );
  }

  const path = opts.path;
  const rotatedPath = `${path}.1`;
  const maxBufferEvents = opts.maxBufferEvents ?? 100;
  const maxBufferBytes = opts.maxBufferBytes ?? 65_536;
  const flushIntervalMs = opts.flushIntervalMs ?? 1000;

  const fs = opts._fs ?? createNodeFileSink(strategyName);

  // Claim the file NOW. Two things this buys, both worth the syscall:
  //   1. an unwritable path (no directory, no permission, a directory where a
  //      file should be, a read-only mount) is refused at construction, where
  //      the caller can still read the message;
  //   2. `statSync` below gives the rotation counter a true starting size, so a
  //      restart appends to an existing file rather than believing it is empty.
  let bytesOnDisk = 0;
  try {
    const dir = parentDir(path);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path, '');
    bytesOnDisk = fs.statSync(path).size;
  } catch (err) {
    throw new Error(
      `[${strategyName}Observability] cannot write '${path}': ${errorMessage(err)}. ` +
        `The parent directory is created for you; a failure here means the path is a ` +
        `directory, the mount is read-only, or the process user lacks permission. ` +
        `Fix the path or the permission — this sink refuses to start rather than ` +
        `silently drop every event.`,
    );
  }

  // Buffered lines — drained by `flush()` / size trigger / timer.
  const buffer: string[] = [];
  let bufferBytes = 0;
  let lastFlushPromise: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  // The fallback when the consumer wires nothing. Rate-limited; a
  // consumer-supplied sink is not.
  const consoleSink = rateLimitedConsoleSink(strategyName);

  function scheduleTimedFlush(): void {
    if (timer || flushIntervalMs <= 0 || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void doFlush();
    }, flushIntervalMs);
    // Never hold the process open for telemetry. `unref` exists on Node's
    // Timeout and not on the browser's number — feature-detected, so a
    // non-Node runtime with an injected `_fs` still works.
    (timer as { unref?: () => void }).unref?.();
  }

  /** Route a delivery failure through whatever `_onError` IS RIGHT NOW —
   *  reading it at call time, so a consumer who assigns `_onError` after
   *  construction still receives them (the 8.11.0 fix). */
  function reportFailure(err: Error): void {
    strategy._onError?.(err);
  }

  /** ONE generation. A file already at or over the ceiling is renamed to
   *  `<path>.1` (replacing any previous `.1`) and the counter resets. A batch
   *  bigger than the whole ceiling is still written — truncating a run's
   *  telemetry to fit a dial nobody set for that purpose would be worse. */
  async function rotateIfNeeded(incomingBytes: number): Promise<void> {
    const ceiling = opts.maxBytes;
    if (ceiling === undefined) return;
    if (bytesOnDisk === 0) return;
    if (bytesOnDisk + incomingBytes <= ceiling) return;
    await fs.rename(path, rotatedPath);
    bytesOnDisk = 0;
  }

  async function doFlush(): Promise<void> {
    // `stopped` is deliberately NOT a guard here — same stance as the AWS
    // adapters since 8.11.1. `stop()` stops this strategy ACCEPTING events; it
    // does not authorise throwing away events already accepted, and a `flush()`
    // that cannot make progress after a `stop()` is how shutdown spins forever.
    if (buffer.length === 0) return;
    // Snapshot + clear so events emitted during the in-flight write accumulate
    // into the next batch.
    const batch = buffer.splice(0);
    const batchBytes = bufferBytes;
    bufferBytes = 0;
    const data = `${batch.join('\n')}\n`;
    try {
      await rotateIfNeeded(batchBytes);
      await fs.appendFile(path, data);
      bytesOnDisk += byteLength(data);
    } catch (err) {
      reportFailure(
        new Error(`${batch.length} event(s) dropped writing to '${path}': ${errorMessage(err)}`),
      );
    }
  }

  function enqueue(event: AgentfootprintEvent): void {
    if (stopped) return;
    // The hot path must not throw (port law). `JSON.stringify` can — a cycle, a
    // BigInt, a throwing getter — and an event that cannot be serialized is a
    // reportable fact, not a reason to break the agent loop.
    let line: string;
    try {
      line = JSON.stringify(event);
    } catch (err) {
      reportFailure(
        new Error(
          `event '${event?.type ?? 'unknown'}' could not be serialized: ` + errorMessage(err),
        ),
      );
      return;
    }
    // `JSON.stringify` returns undefined for an undefined input — nothing to
    // write, and a bare "undefined" line would corrupt the NDJSON stream.
    if (line === undefined) return;
    buffer.push(line);
    bufferBytes += byteLength(line) + 1; // + the newline this line will carry

    if (buffer.length >= maxBufferEvents || bufferBytes >= maxBufferBytes) {
      // Size trigger. Chain onto the last write rather than racing it — the
      // file's line order IS the dispatch order, and that is the only thing an
      // offline reader can rely on.
      lastFlushPromise = lastFlushPromise.then(doFlush, doFlush);
    } else {
      scheduleTimedFlush();
    }
  }

  const strategy: ObservabilityStrategy = {
    name: strategyName,
    capabilities: { events: true, logs: true },
    ...(opts.eventTypes && { relevantEventTypes: opts.eventTypes }),
    exportEvent: enqueue,
    /**
     * Write what is buffered. Called for you on shutdown (8.12.0) — by the
     * handle `enable.observability()` returns, by `agent.shutdown()`, and by a
     * `standingAgent` closing. Safe at any time, including after `stop()`.
     */
    async flush(): Promise<void> {
      // BOUNDED BY CONSTRUCTION — every pass must remove at least one buffered
      // line; a pass that removes none ends the drain instead of retrying. The
      // shape the CloudWatch adapter arrived at in 8.11.1, for the same reason:
      // a drain that cannot finish must return, never spin.
      for (;;) {
        const pending = buffer.length;
        lastFlushPromise = lastFlushPromise.then(doFlush, doFlush);
        await lastFlushPromise;
        if (buffer.length === 0) return;
        if (buffer.length >= pending) return;
      }
    },
    /** Clear the timer and stop accepting events. Terminal: there is no
     *  restart. What it does NOT do is discard the buffer — `flush()` after
     *  `stop()` still writes it. */
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    /** Where failures go. Two callers: the dispatch layer (when `exportEvent`
     *  itself throws) and this adapter's own write path. */
    _onError(err: Error, event?: AgentfootprintEvent): void {
      (opts.onError ?? consoleSink)(err, event);
    },
  };

  return strategy;
}

// ─── node:fs binding (lazy) ──────────────────────────────────────────

/**
 * Bind {@link FileSinkFs} to `node:fs`. Lazily required so that importing
 * `agentfootprint/observe` in a browser bundle never resolves `node:fs` — only
 * CALLING this factory does, and a runtime without it is refused by name.
 */
function createNodeFileSink(strategyName: string): FileSinkFs {
  let mod: typeof import('node:fs');
  try {
    mod = lazyRequire<typeof import('node:fs')>('node:fs');
  } catch {
    throw new Error(
      `[${strategyName}Observability] needs \`node:fs\`, and this runtime has none. ` +
        `It is a Node-only sink by definition — a browser has no local file to append to. ` +
        `In a browser, ship events over your own transport, or pass \`_fs\` to write ` +
        `somewhere you control.`,
    );
  }
  return {
    mkdirSync: (dir, options) => void mod.mkdirSync(dir, options),
    appendFileSync: (file, data) => mod.appendFileSync(file, data),
    statSync: (file) => mod.statSync(file),
    appendFile: (file, data) => mod.promises.appendFile(file, data),
    rename: (from, to) => mod.promises.rename(from, to),
  };
}

// ─── Small helpers ───────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** UTF-8 byte length. `Buffer` where there is one, `TextEncoder` otherwise —
 *  the byte count decides rotation, so a multi-byte prompt must not be counted
 *  as its character length. */
function byteLength(s: string): number {
  const B = (globalThis as { Buffer?: { byteLength(s: string, enc: string): number } }).Buffer;
  if (B) return B.byteLength(s, 'utf8');
  return new TextEncoder().encode(s).length;
}

/** The directory part of a path, POSIX or Windows separators, or `''` for a
 *  bare filename (nothing to create). Done by hand rather than through
 *  `node:path` so the module has exactly one Node import, behind one seam. */
function parentDir(file: string): string {
  const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (idx <= 0) return '';
  return file.slice(0, idx);
}
