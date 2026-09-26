/**
 * ROUND 4 — the recheck of the wire rule (idfix-RECHECK.md, W1–W5), each
 * reviewer attack ported with its assertion INVERTED.
 *
 * The laws being pinned:
 *   • RB2 — an Error with `toJSON` (every real `AxiosError`) is rendered by the
 *     rule on the sync path too: the replacer reads the HOLDER's raw value, so
 *     `toJSON` never pre-empts it. Sync and detached write the same bytes.
 *   • RB3 — the browser stream (`toSSE`), the recording artifact and the
 *     recording file sink serialize through the rule.
 *   • NIT 1 — `wireError` and `withWireErrors` never throw.
 *   • NIT 2 — the Error check is not fooled by `Symbol.toStringTag`.
 *   • NIT 4 — an Error inside a Map or Set reaches a detached sink without its
 *     stack.
 *
 * Real axios is not a dependency of this repo, so the shape below is axios
 * 1.x's `AxiosError.prototype.toJSON`, verbatim; the reviewer's real-axios
 * probe is kept and runs where that checkout exists.
 *
 * Test types (Convention 3): security · regression · property · unit.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { microtaskBatchDriver } from 'footprintjs/detach';

import { Agent, recordingPutInput } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { fileObservability } from '../../src/adapters/observability/file.js';
import { fileRecordingSink } from '../../src/recorders/observability/fileRecordingSink.js';
import { recordRun } from '../../src/recorders/observability/recordRun.js';
import { toSSE } from '../../src/stream.js';
import { toWireJson, withWireErrors, wireError } from '../../src/lib/wireJson.js';
import { AxiosLikeError } from './axiosLikeError.js';

const TOKEN = 'Bearer tok-RECHECK';

function agentReturning(result: () => unknown): Agent {
  const provider = new MockProvider({
    replies: [{ toolCalls: [{ id: 't1', name: 'svc', args: {} }] }, 'done'],
  });
  return Agent.create({ provider, model: 'mock' })
    .system('')
    .tool({
      schema: { name: 'svc', description: 'd', inputSchema: { type: 'object' } },
      execute: result,
    })
    .build();
}

/** The tool_end line's RESULT as the file sink wrote it (durations and meta removed). */
async function fileResult(result: () => unknown, detached: boolean): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'recheck-wire-'));
  const path = join(dir, 'events.ndjson');
  const file = fileObservability({ path, onError: () => undefined });
  const agent = agentReturning(result);
  const off = agent.enable.observability({
    strategy: file,
    ...(detached && { detach: { driver: microtaskBatchDriver, mode: 'forget' } }),
  } as never) as unknown as { (): void; flush?: () => Promise<void> };
  await agent.run({ message: 'go' });
  await off.flush?.();
  await new Promise((resolve) => setTimeout(resolve, 30));
  off();
  await file.flush?.();
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  const line = lines.find((l) => l.includes('"agentfootprint.stream.tool_end"'));
  if (line === undefined) return undefined;
  return JSON.stringify((JSON.parse(line) as { payload?: { result?: unknown } }).payload?.result);
}

const decorated = () =>
  Object.assign(new Error('upstream 401'), { config: { headers: { authorization: TOKEN } } });

describe('RB2 (W1) — an Error with toJSON is rendered by the rule, not by its toJSON', () => {
  it('toWireJson writes no Authorization header and no stack; withWireErrors agrees', () => {
    const err = new AxiosLikeError('Request failed with status code 401');
    const written = toWireJson({ result: err });
    expect(written).not.toContain('tok-RECHECK');
    expect(written).not.toContain('"stack"');
    expect(written).toBe(JSON.stringify(withWireErrors({ result: err })));
    expect(JSON.parse(written)).toEqual({
      result: {
        name: 'AxiosError',
        message: 'Request failed with status code 401',
        code: 'ERR_BAD_REQUEST',
      },
    });
    // A root Error with toJSON too (the root holder is { '': value }).
    expect(toWireJson(err)).not.toContain('tok-RECHECK');
  });

  it('the file sink writes the same bytes on the sync and the detached path, with no token', async () => {
    const sync = await fileResult(() => ({ error: new AxiosLikeError('401') }), false);
    const detached = await fileResult(() => ({ error: new AxiosLikeError('401') }), true);
    expect(sync).toBeDefined();
    expect(sync).not.toContain('tok-RECHECK');
    expect(detached).toBe(sync);
  });

  it('REAL axios (where that checkout exists on this machine) is rendered by the rule', () => {
    const where =
      '/Users/sanjay/eb1a-case/.codex-staging/missionfootprint-phase25/node_modules/openmct/src/plugins/persistence/couch/node_modules/axios/dist/node/axios.cjs';
    if (!existsSync(where)) return;
    const axios = createRequire(import.meta.url)(where) as {
      AxiosError: new (m: string, c: string, config: object) => Error;
    };
    const err = new axios.AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', {
      headers: { Authorization: TOKEN },
    });
    expect(toWireJson({ result: err })).not.toContain('tok-RECHECK');
  });
});

describe('RB3 (W2) — toSSE streams an Error by the rule', () => {
  it('a tool returning a decorated Error streams no custom property to the client', async () => {
    const agent = agentReturning(() => ({ error: decorated() }));
    const chunks: string[] = [];
    const pump = (async () => {
      for await (const chunk of toSSE(agent)) chunks.push(chunk);
    })();
    await agent.run({ message: 'go' });
    await pump;
    const toolEnd = chunks.find((c) => c.includes('tool_end'));
    expect(toolEnd).toBeDefined();
    expect(toolEnd).not.toContain('tok-RECHECK');
    expect(toolEnd).toContain('upstream 401');
  });
});

describe('RB3 (W3) — a recording is serialized by the rule', () => {
  it('the recording artifact payload carries no Error custom property (plain and toJSON Errors)', async () => {
    const agent = agentReturning(() => ({ error: decorated(), axios: new AxiosLikeError('401') }));
    const rec = recordRun(agent);
    await agent.run({ message: 'go' });
    const put = recordingPutInput(rec.toRecording());
    expect(String(put.data)).not.toContain('tok-RECHECK');
    expect(String(put.data)).toContain('upstream 401');
  });

  it('the recording file sink writes no Error custom property', async () => {
    const agent = agentReturning(() => ({ error: decorated() }));
    const rec = recordRun(agent);
    await agent.run({ message: 'go' });
    const directory = mkdtempSync(join(tmpdir(), 'recheck-recording-'));
    const sink = fileRecordingSink({ directory });
    const envelope = { run: { runId: 'run-w3' }, recording: rec.toRecording() };
    await sink.write(envelope as never);
    const written = readFileSync(join(directory, 'run-w3.json'), 'utf8');
    expect(written).not.toContain('tok-RECHECK');
    expect(written).toContain('upstream 401');
  });
});

describe('NIT 1 (W4) — the rule is total', () => {
  it('a revoked Proxy in an event does not make the walk throw', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const event = { payload: { handle: proxy, error: decorated() } };
    expect(() => withWireErrors(event)).not.toThrow();
    expect(() => withWireErrors({ payload: { handle: proxy } })).not.toThrow();
  });

  it('wireError never throws: a message whose toString throws reads as empty', () => {
    const err = new Error('x');
    Object.defineProperty(err, 'message', {
      value: {
        toString() {
          throw new Error('boom');
        },
      },
    });
    expect(() => wireError(err)).not.toThrow();
    expect(wireError(err)).toEqual({ name: 'Error', message: '' });
  });

  it('the detached path with a revoked proxy in a tool result: the run completes', async () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    await expect(fileResult(() => ({ handle: proxy }), true)).resolves.not.toBeInstanceOf(Error);
  });
});

describe('NIT 2 (W5) — byte identity for Error-free values', () => {
  it('an object with Symbol.toStringTag "Error" is NOT rendered as an Error', () => {
    const value = { [Symbol.toStringTag]: 'Error', message: 'm', data: 'kept' };
    expect(toWireJson({ v: value })).toBe(JSON.stringify({ v: value }));
    expect(withWireErrors({ v: value })).toEqual({ v: value });
  });

  it('property (HOLD): toWireJson === JSON.stringify for JSON values (200 seeds)', () => {
    let a = 7;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gen = (d: number): unknown => {
      const k = Math.floor(rnd() * 9);
      if (d > 4 || k < 3)
        return [null, true, 1.5, -0, 'x y', '\ud800', 1e21][Math.floor(rnd() * 7)];
      if (k < 5) return [gen(d + 1), undefined, gen(d + 1)];
      if (k < 6) return new Date(Math.floor(rnd() * 1e12));
      if (k < 7) {
        const fixed = gen(d + 1);
        return { toJSON: () => fixed };
      }
      return { a: gen(d + 1), b: undefined, ['__proto__x']: gen(d + 1) };
    };
    for (let i = 0; i < 200; i++) {
      const v = gen(0);
      expect(toWireJson(v)).toBe(JSON.stringify(v));
      expect(withWireErrors(v)).toBe(v);
    }
  });
});

describe('NIT 4 — an Error inside a Map or Set reaches a detached sink without its stack', () => {
  it('withWireErrors renders Map values and Set members', () => {
    const err = decorated();
    const safe = withWireErrors({ m: new Map([['e', err]]), s: new Set([err]) }) as {
      m: Map<string, unknown>;
      s: Set<unknown>;
    };
    const rendered = { name: 'Error', message: 'upstream 401' };
    expect(safe.m.get('e')).toEqual(rendered);
    expect([...safe.s]).toEqual([rendered]);
    expect(JSON.stringify([...safe.m.values(), ...safe.s])).not.toContain('stack');
  });
});
