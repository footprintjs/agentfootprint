/**
 * THE WIRE RULE FOR ERRORS — `lib/wireJson.ts`, shared by both delivery paths.
 *
 * Before this fix an `Error` inside an event (a tool that returned the error a
 * client library threw, say) reached every serializing sink on the
 * SYNCHRONOUS path through `JSON.stringify`, which writes an Error's own
 * enumerable properties — an axios error's `config.headers.authorization`
 * landed in the NDJSON file, the audit export and CloudWatch. The DETACHED
 * path's `structuredClone` dropped those properties (and `code`, and on some
 * Node versions `cause`) and wrote `{}`. Two paths, two byte shapes.
 *
 * The laws being pinned:
 *   • An Error is written as `{ name, message, code? }` plus a bounded `cause`
 *     chain — never a custom property, never `stack`.
 *   • Sync and detached delivery write the SAME bytes for payloads holding
 *     Errors — nested, with a cause chain, circular through a cause or a
 *     custom property, and plain circular data (which both refuse alike).
 *   • `authorization` is written by no sink, on either path.
 *
 * Test types (Convention 3): security (the axios token, `tok-R4-AXIOS` from
 * the round-4 devil reproduction) · property (seeded payload generator, sync ≡
 * detached) · unit (`toWireJson` / `withWireErrors`) · regression (a payload
 * with no Error serializes exactly as `JSON.stringify` did).
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { microtaskBatchDriver } from 'footprintjs/detach';

import { Agent } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { fileObservability } from '../../src/adapters/observability/file.js';
import { auditExport } from '../../src/adapters/observability/audit.js';
import { cloudwatchObservability } from '../../src/adapters/observability/cloudwatch.js';
import { consoleObservability } from '../../src/strategies/defaults/consoleObservability.js';
import { toWireJson, withWireErrors, MAX_CAUSE_DEPTH } from '../../src/lib/wireJson.js';
import { AxiosLikeError } from './axiosLikeError.js';

const TOKEN = 'Bearer tok-R4-AXIOS';

/** An axios-shaped error: a code, and the request headers hung on it. */
function axiosError(message = 'upstream 401'): Error {
  return Object.assign(new Error(message), {
    code: 'ERR_BAD_REQUEST',
    config: { headers: { authorization: TOKEN } },
    response: { status: 401, headers: { 'set-cookie': 'sid=tok-R4-AXIOS' } },
  });
}

/** A tiny deterministic PRNG (mulberry32) — a failing seed replays exactly. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A payload holding Errors in the shapes the law names, chosen by the seed. */
function errorPayload(seed: number): unknown {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const makeError = (depth: number): Error => {
    const kind = pick([
      'axios',
      'axios-tojson',
      'plain',
      'type',
      'caused',
      'self-cause',
      'self-prop',
      'number-code',
    ]);
    if (kind === 'axios') return axiosError(`axios ${depth}`);
    // A real AxiosError carries `toJSON` (config + stack) — recheck RB2.
    if (kind === 'axios-tojson') return new AxiosLikeError(`axios-json ${depth}`, TOKEN);
    if (kind === 'plain') return new Error(`plain ${depth}`);
    if (kind === 'type') return Object.assign(new TypeError(`type ${depth}`), { secret: TOKEN });
    if (kind === 'number-code')
      return Object.assign(new RangeError(`range ${depth}`), { code: 42 });
    if (kind === 'caused') {
      return new Error(`outer ${depth}`, {
        cause: depth < 6 ? makeError(depth + 1) : axiosError('deepest'),
      });
    }
    const err = axiosError(`cyclic ${depth}`) as Error & { cause?: unknown; config: object };
    if (kind === 'self-cause') err.cause = err;
    else (err.config as { self?: unknown }).self = err;
    return err;
  };
  const leaf = (depth: number): unknown => {
    const kind = pick(['error', 'error', 'text', 'number', 'object', 'array']);
    if (kind === 'error') return makeError(0);
    if (kind === 'text') return `text-${Math.floor(random() * 1000)}`;
    if (kind === 'number') return Math.floor(random() * 1000);
    if (depth > 3) return null;
    if (kind === 'object') return { a: leaf(depth + 1), b: leaf(depth + 1) };
    return [leaf(depth + 1), leaf(depth + 1)];
  };
  return { ok: false, found: leaf(0), list: [leaf(1), makeError(0)] };
}

interface Delivered {
  readonly file: string | undefined;
  readonly audit: string;
  readonly auditBounded: string;
  readonly cloudwatch: string | undefined;
  readonly console: string;
}

/**
 * One run whose tool returns `result`, delivered to every sink — synchronously,
 * or through the detached driver. Returns each sink's `tool_end` RESULT, as
 * written: the durations and meta a second run could not reproduce are removed.
 */
async function deliver(result: () => unknown, detached: boolean): Promise<Delivered> {
  const dir = mkdtempSync(join(tmpdir(), 'wire-errors-'));
  const path = join(dir, 'events.ndjson');
  const file = fileObservability({ path, onError: () => undefined });
  const audit = auditExport({ payloadMode: 'verbatim' } as never);
  const auditBounded = auditExport();
  const cloud: string[] = [];
  const cloudwatch = cloudwatchObservability({
    logGroupName: 'g',
    logStreamName: 's',
    flushIntervalMs: 0,
    _client: {
      putLogEvents: async (input) => {
        for (const e of input.logEvents) cloud.push(e.message);
        return {};
      },
    },
  } as never);
  const printed: string[] = [];
  const console = consoleObservability({
    logger: { log: (...args) => printed.push(args.join(' ')) },
  });

  const provider = new MockProvider({
    replies: [{ toolCalls: [{ id: 't1', name: 'svc', args: {} }] }, 'done'],
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .system('')
    .tool({
      schema: { name: 'svc', description: 'd', inputSchema: { type: 'object' } },
      execute: result,
    })
    .build();
  const handles = [file, audit, auditBounded, cloudwatch, console].map(
    (strategy) =>
      agent.enable.observability({
        strategy,
        ...(detached && { detach: { driver: microtaskBatchDriver, mode: 'forget' } }),
      } as never) as unknown as { (): void; flush?: () => Promise<void> },
  );
  try {
    await agent.run({ message: 'go' });
    for (const h of handles) await h.flush?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    for (const h of handles) h();
    await file.flush?.();
    await cloudwatch.flush?.();
  }
  const toolEnd = (line: string) => line.includes('"agentfootprint.stream.tool_end"');
  const resultOf = (json: string | undefined): string | undefined => {
    if (json === undefined) return undefined;
    const parsed = JSON.parse(json) as { payload?: { result?: unknown } };
    return JSON.stringify(parsed.payload?.result);
  };
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  const auditResult = (strategy: typeof audit) =>
    JSON.stringify(
      (
        strategy.bundle().records as Array<{ eventType: string; payload: { result?: unknown } }>
      ).find((r) => r.eventType === 'agentfootprint.stream.tool_end')?.payload?.result,
    );
  return {
    file: resultOf(lines.find(toolEnd)),
    audit: auditResult(audit),
    auditBounded: auditResult(auditBounded),
    cloudwatch: resultOf(cloud.find(toolEnd)),
    console: printed
      .filter((line) => line.includes('tool_end'))
      .map((line) => line.replace(/"durationMs":\d+/g, '"durationMs":0'))
      .join('\n'),
  };
}

describe('the wire rule — unit', () => {
  it('renders an Error as name, message, code and a bounded cause — nothing else', () => {
    const inner = axiosError('inner');
    const outer = Object.assign(new Error('outer', { cause: inner }), { code: 7, extra: TOKEN });
    expect(JSON.parse(toWireJson({ e: outer }))).toEqual({
      e: {
        name: 'Error',
        message: 'outer',
        code: 7,
        cause: { name: 'Error', message: 'inner', code: 'ERR_BAD_REQUEST' },
      },
    });

    let chain: Error = new Error('root');
    for (let i = 0; i < 10; i++) chain = new Error(`level ${i}`, { cause: chain });
    let depth = 0;
    for (let node = JSON.parse(toWireJson(chain)); node?.cause; node = node.cause) depth += 1;
    expect(depth).toBe(MAX_CAUSE_DEPTH - 1);

    const self = axiosError() as Error & { cause?: unknown };
    self.cause = self;
    expect(toWireJson(self)).not.toContain('tok-R4-AXIOS');
  });

  it('changes nothing about a value that holds no Error — same bytes, same reference', () => {
    const value = { a: [1, 'x', { b: null }], d: new Date(0), m: new Map([['k', 1]]) };
    expect(toWireJson(value)).toBe(JSON.stringify(value));
    expect(withWireErrors(value)).toBe(value);
  });

  it('withWireErrors keeps a cycle on the copy, never on the Error-holding original', () => {
    const node: Record<string, unknown> = {};
    node.self = node;
    node.err = axiosError();
    const safe = withWireErrors(node) as Record<string, unknown>;
    expect(safe).not.toBe(node);
    expect(safe.self).toBe(safe);
    expect(safe.err).toEqual({ name: 'Error', message: 'upstream 401', code: 'ERR_BAD_REQUEST' });
  });
});

describe('the wire rule — every sink, both delivery paths', () => {
  it('the axios token is written by no sink, on either path', async () => {
    for (const detached of [false, true]) {
      const out = await deliver(() => ({ error: axiosError() }), detached);
      const all = JSON.stringify(out);
      expect(all, `detached=${detached}`).not.toContain('tok-R4-AXIOS');
      expect(all, `detached=${detached}`).not.toContain('authorization');
      expect(out.file).toBe(
        '{"error":{"name":"Error","message":"upstream 401","code":"ERR_BAD_REQUEST"}}',
      );
    }
  });

  it('property: sync and detached delivery write the same bytes for payloads holding Errors', async () => {
    const written: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const sync = await deliver(() => errorPayload(seed), false);
      const detached = await deliver(() => errorPayload(seed), true);
      expect(detached, `seed ${seed}`).toEqual(sync);
      expect(JSON.stringify(sync), `seed ${seed}`).not.toContain('tok-R4-AXIOS');
      expect(sync.file, `seed ${seed} wrote nothing`).toBeDefined();
      written.push(sync.file as string);
    }
    // The seeds really exercised the shapes the law names.
    const all = written.join('\n');
    expect(all).toContain('"cause":{"name"');
    expect(all).toContain('"code":"ERR_BAD_REQUEST"');
    expect(all).toContain('"name":"TypeError"');
    expect(all).toContain('"name":"AxiosError"');
  });

  it('plain circular data is refused alike by both paths (no line), and the audit breaks it alike', async () => {
    const circular = () => {
      const node: Record<string, unknown> = { error: axiosError() };
      node.self = node;
      return node;
    };
    const sync = await deliver(circular, false);
    const detached = await deliver(circular, true);
    expect(sync.file).toBeUndefined();
    expect(detached).toEqual(sync);
    expect(JSON.stringify(sync)).not.toContain('tok-R4-AXIOS');
  });
});
