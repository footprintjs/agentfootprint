/**
 * The receipt mint is incremental — `receiptDigests.ts` (the run's memo),
 * `receipt.ts` · `transformHashOf` (the chained transform fingerprint) and
 * `requestMeasurement.ts` · `measureRequest` (sized per message).
 *
 * Test types:
 *   - DIFFERENTIAL — `measureRequest`, with and without a memo, against the
 *                    whole-walk measurement it replaced (the CONTROL in
 *                    fixtures/measureRequestWhole.ts), over 400 generated call
 *                    sequences: odd values, refused values, cycles, both limits.
 *   - EQUIVALENCE  — a receipt minted through the memo is byte-identical to one
 *                    minted without it, call after call, edits included.
 *   - CONTRACT     — `transformHashOf` recomputes `cache.transformHash`; the
 *                    value names its scheme.
 *   - RETENTION    — the memo holds two calls' worth, never the run's: a piece
 *                    that changes every call is gone by the next one.
 *   - TOTAL        — a property that throws when read never makes the mint
 *                    throw (a receipt is bookkeeping): memo or not, the same
 *                    receipt; `transformHashOf` never throws.
 *   - WORK COUNT   — on a real agent run (mock provider, caching declared), the
 *                    SHA-256 input and the UTF-8 encoding the mint does per call
 *                    stay flat as the run grows, and 4× the iterations cost
 *                    about 4× the work — never the 16× they cost before.
 */
import { describe, expect, it, vi } from 'vitest';

const meter = vi.hoisted(() => ({
  minting: false,
  shaChars: 0,
  encodeChars: 0,
  perMint: [] as { sha: number; encode: number; transform: string }[],
}));

vi.mock('../../../src/lib/time-travel/sha256.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/lib/time-travel/sha256.js')>();
  return {
    ...real,
    sha256Hex: (text: string) => {
      if (meter.minting) meter.shaChars += text.length;
      return real.sha256Hex(text);
    },
  };
});

vi.mock('../../../src/lib/time-travel/receipt.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/lib/time-travel/receipt.js')>();
  return {
    ...real,
    buildReceipt: (...args: Parameters<typeof real.buildReceipt>) => {
      const sha = meter.shaChars;
      const encode = meter.encodeChars;
      meter.minting = true;
      try {
        const receipt = real.buildReceipt(...args);
        meter.perMint.push({
          sha: meter.shaChars - sha,
          encode: meter.encodeChars - encode,
          transform: receipt.cache.transform,
        });
        return receipt;
      } finally {
        meter.minting = false;
      }
    },
  };
});

import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import {
  buildReceipt,
  receiptHash,
  stableJson,
  transformHashOf,
  TRANSFORM_HASH_PREFIX,
  type BuildReceiptInput,
} from '../../../src/lib/time-travel/receipt.js';
import { createReceiptDigests } from '../../../src/lib/time-travel/receiptDigests.js';
import { measureRequest } from '../../../src/lib/time-travel/requestMeasurement.js';
import { measureRequestWhole } from './fixtures/measureRequestWhole.js';

// ── A seeded generator (no dependency) ───────────────────────────────────────

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRINGS = ['', 'a', 'héllo', '😀 ok', '\uD800 lone', 'line\nbreak "q"', 'x'.repeat(300)];

function value(r: () => number, depth: number): unknown {
  const roll = r();
  if (depth > 3 || roll < 0.45) {
    const p = r();
    if (p < 0.3) return STRINGS[Math.floor(r() * STRINGS.length)];
    if (p < 0.5) return [0, -0, 1.5, NaN, Infinity, 42][Math.floor(r() * 6)];
    if (p < 0.6) return r() < 0.5;
    if (p < 0.7) return null;
    if (p < 0.78) return undefined;
    if (p < 0.8) return 1n; // refused: a BigInt
    if (p < 0.81) return () => 1; // refused: a function
    return 'plain';
  }
  if (roll < 0.7) {
    const out: unknown[] = [];
    const n = Math.floor(r() * 4);
    for (let i = 0; i < n; i++) out.push(value(r, depth + 1));
    if (r() < 0.05) out.length += 1; // a hole
    return out;
  }
  const out: Record<string, unknown> = {};
  const n = Math.floor(r() * 4);
  for (let i = 0; i < n; i++) out[`k${Math.floor(r() * 6)}`] = value(r, depth + 1);
  const odd = r();
  if (odd < 0.02) Object.defineProperty(out, 'hidden', { value: 1, enumerable: false });
  else if (odd < 0.03) Object.defineProperty(out, 'g', { get: () => 1, enumerable: true });
  else if (odd < 0.04) return new Date(0); // refused: not a plain object
  return out;
}

function message(r: () => number, i: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: r() < 0.5 ? 'user' : 'tool',
    content: r() < 0.9 ? `m${i} ${STRINGS[i % STRINGS.length]}` : value(r, 1),
  };
  if (r() < 0.4) out.toolCalls = [{ id: `c${i}`, name: 't', args: value(r, 1) }];
  if (r() < 0.03) out.self = out; // a cycle inside one message
  return out;
}

/** A sequence of requests, each the last one's messages (the SAME objects)
 *  plus a few more — how an agent's history grows. */
function sequence(seed: number): Record<string, unknown>[] {
  const r = rng(seed);
  const messages: Record<string, unknown>[] = [];
  const out: Record<string, unknown>[] = [];
  for (let call = 0; call < 4; call++) {
    const added = 1 + Math.floor(r() * 3);
    for (let i = 0; i < added; i++) messages.push(message(r, messages.length));
    if (r() < 0.1 && messages.length > 1) messages[0] = message(r, 99); // a replaced line
    const request: Record<string, unknown> = {
      model: 'm',
      ...(r() < 0.5 && { systemPrompt: 'sys' }),
      messages: [...messages],
      tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }],
      ...(r() < 0.3 && { signal: { aborted: false } }),
      ...(r() < 0.3 && { cacheMarkers: [{ field: 'messages', boundaryIndex: 0, ttl: 'short' }] }),
    };
    if (r() < 0.03) (request.messages as unknown[]).push(request); // a cycle to the root
    out.push(request);
  }
  return out;
}

describe('measureRequest — incremental, and equal to the whole walk', () => {
  it('DIFFERENTIAL: 400 generated call sequences, with and without a memo', () => {
    let measured = 0;
    let unavailable = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const memo = createReceiptDigests().forRun('run-1');
      for (const request of sequence(seed)) {
        const whole = measureRequestWhole(request);
        expect(measureRequest(request)).toEqual(whole);
        expect(measureRequest(request, memo)).toEqual(whole);
        if (whole.status === 'measured') measured += 1;
        else unavailable += 1;
      }
    }
    // The generator exercises both outcomes, not just one.
    expect(measured).toBeGreaterThan(200);
    expect(unavailable).toBeGreaterThan(50);
  });

  it('DIFFERENTIAL: the character limit, crossed by messages the memo already holds', () => {
    const memo = createReceiptDigests().forRun('run-1');
    const big = (i: number) => ({ role: 'tool', content: String(i).repeat(900_000) });
    const messages: object[] = [];
    for (let call = 0; call < 6; call++) {
      messages.push(big(call));
      const request = { model: 'm', messages: [...messages] };
      expect(measureRequest(request, memo)).toEqual(measureRequestWhole(request));
    }
    expect(measureRequest({ model: 'm', messages }, memo)).toMatchObject({
      status: 'unavailable',
      reason: 'measurement-limit',
    });
  });

  it('DIFFERENTIAL: the value limit — counted, and sized up front — across held messages', () => {
    const memo = createReceiptDigests().forRun('run-1');
    const wide = () => ({
      role: 'tool',
      content: 'r',
      rows: Array.from({ length: 30_000 }, () => 0),
    });
    const messages: object[] = [];
    for (let call = 0; call < 5; call++) {
      messages.push(wide());
      const request = { model: 'm', messages: [...messages], tools: [] };
      expect(measureRequest(request, memo)).toEqual(measureRequestWhole(request));
    }
    // A held message replayed where its up-front size check (not its count)
    // is what crosses the budget.
    const late = { role: 'tool', content: 'r', rows: Array.from({ length: 99_000 }, () => 0) };
    expect(measureRequest({ model: 'm', messages: [late] }, memo)).toEqual(
      measureRequestWhole({ model: 'm', messages: [late] }),
    );
    const padded = { model: 'm', pad: Array.from({ length: 1_500 }, () => 0), messages: [late] };
    expect(measureRequest(padded, memo)).toEqual(measureRequestWhole(padded));
  });

  it('a message whose fields changed is measured again, not replayed', () => {
    const memo = createReceiptDigests().forRun('run-1');
    const line: Record<string, unknown> = { role: 'user', content: 'short' };
    expect(measureRequest({ messages: [line] }, memo)).toEqual(
      measureRequestWhole({ messages: [line] }),
    );
    line.content = 'a much longer content than before';
    expect(measureRequest({ messages: [line] }, memo)).toEqual(
      measureRequestWhole({ messages: [line] }),
    );
  });
});

// ── The receipt: memo on, memo off — the same bytes ─────────────────────────

function receiptInputs(seed: number): BuildReceiptInput[] {
  const r = rng(seed);
  const history: LLMMessage[] = [];
  const out: BuildReceiptInput[] = [];
  const tools = [{ name: 't', description: 'd', inputSchema: { type: 'object' } }];
  for (let call = 0; call < 5; call++) {
    history.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `c${call}`, name: 't', args: { k: call } }],
    } as LLMMessage);
    history.push({
      role: 'tool',
      content: `rows ${call} ${'x'.repeat(200)}`,
      toolCallId: `c${call}`,
    } as LLMMessage);
    if (r() < 0.2) history[0] = { ...history[0]!, content: `edited ${call}` } as LLMMessage;
    const messages = [...history];
    const baseRequest = { model: 'm', systemPrompt: 'sys', messages, tools };
    const mode = r();
    const preparedRequest =
      mode < 0.4
        ? baseRequest // unchanged
        : mode < 0.8
        ? {
            ...baseRequest,
            cacheMarkers: [{ field: 'messages', boundaryIndex: call, ttl: 'short' }],
          }
        : { ...baseRequest, messages: messages.map((m) => ({ ...m })), maxTokens: 9 }; // rebuilt
    out.push({
      runId: 'run-7',
      epoch: call,
      model: 'm',
      provider: 'mock',
      systemText: 'sys',
      systemPieces: [],
      messages,
      requestOnly: [],
      tools,
      forced: null,
      withheld: null,
      baseRequest,
      preparedRequest,
      strategy: 'breakpoints',
      ...(call > 2 && { omittedForAttention: [history[0]!] }),
    } as BuildReceiptInput);
  }
  return out;
}

describe('buildReceipt — the memo changes no byte', () => {
  it('EQUIVALENCE: 60 call sequences, unchanged / marked / rebuilt requests', () => {
    const transforms = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const digests = createReceiptDigests();
      for (const input of receiptInputs(seed)) {
        const plain = buildReceipt(input);
        expect(buildReceipt(input, digests)).toEqual(plain);
        transforms.add(plain.cache.transform);
      }
    }
    expect([...transforms].sort()).toEqual(['rewritten', 'unchanged']);
  });

  it("EQUIVALENCE: a message nobody can serialize is 'unknown' with and without the memo", () => {
    const [input] = receiptInputs(3);
    const odd = { role: 'tool', content: 'x', toolCallId: 'c', extra: 1n } as unknown as LLMMessage;
    const messages = [...input!.messages, odd];
    const base = { ...(input!.baseRequest as object), messages };
    const prepared = { ...base, cacheMarkers: [] };
    const next = { ...input!, messages, baseRequest: base, preparedRequest: prepared };
    const plain = buildReceipt(next);
    expect(plain.cache.transform).toBe('unknown');
    expect(buildReceipt(next, createReceiptDigests())).toEqual(plain);
  });

  it('a new run id starts a fresh memo — no digest salted for another run is reused', () => {
    const digests = createReceiptDigests();
    const [input] = receiptInputs(5);
    const first = buildReceipt(input!, digests);
    const other = buildReceipt({ ...input!, runId: 'run-8' }, digests);
    expect(other).toEqual(buildReceipt({ ...input!, runId: 'run-8' }));
    expect(other.messages.entries[0]!.hash).not.toBe(first.messages.entries[0]!.hash);
  });
});

describe('the memo holds two calls, never the run', () => {
  it('RETENTION: a piece that changes every call is gone after the next; a stable one stays found', () => {
    const tools = [{ name: 't', description: 'd', inputSchema: { type: 'object' } }];
    const digests = createReceiptDigests();
    const memo = digests.forRun('run-7'); // the object every mint below reads
    const history: LLMMessage[] = [];
    for (let call = 0; call < 40; call++) {
      history.push({ role: 'user', content: `m${call}` } as LLMMessage);
      const messages = [...history];
      const baseRequest = { model: 'm', systemPrompt: `sys at ${call}`, messages, tools };
      const preparedRequest = { ...baseRequest, cacheMarkers: [{ field: 'messages' }] };
      buildReceipt(
        {
          runId: 'run-7',
          epoch: call,
          model: 'm',
          provider: 'mock',
          systemText: `sys at ${call}`,
          systemPieces: [],
          messages,
          requestOnly: [],
          tools,
          forced: null,
          withheld: null,
          baseRequest,
          preparedRequest,
          strategy: 'breakpoints',
        } as BuildReceiptInput,
        digests,
      );
      // Two calls' worth: per call one system text, one schema, the chain's
      // seed and one link per message — never the 40 calls behind it.
      expect(memo.retained()).toBeLessThanOrEqual(2 * (messages.length + 3));
    }
    const miss = () => 'MISS';
    expect(memo.hash('sys at 0', miss)).toBe('MISS'); // changed every call: not kept
    expect(memo.hash('sys at 39', miss)).not.toBe('MISS'); // this call's: found
  });
});

describe('the mint is total — a receipt never stops a run', () => {
  const throwing = (target: object) =>
    Object.defineProperty(target, 'x', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });

  it('TOTAL: a prepared request with a property that throws when read is "unknown", memo or not', () => {
    const [input] = receiptInputs(9);
    const prepared = throwing({ ...(input!.baseRequest as object) });
    const odd = { ...input!, preparedRequest: prepared };
    const plain = buildReceipt(odd);
    expect(plain.cache.transform).toBe('unknown');
    expect(buildReceipt(odd, createReceiptDigests())).toEqual(plain);
  });

  it('TOTAL: a message with a field that throws when read — memo or not, the same receipt', () => {
    const [input] = receiptInputs(9);
    const line = throwing({ role: 'user', content: 'hi' }) as LLMMessage;
    const messages = [...input!.messages, line];
    const baseRequest = { ...(input!.baseRequest as object), messages };
    const odd = { ...input!, messages, baseRequest, preparedRequest: baseRequest };
    const plain = buildReceipt(odd);
    expect(buildReceipt(odd, createReceiptDigests())).toEqual(plain);
  });

  it('TOTAL: transformHashOf never throws — an unreadable request is the seed and the mark', () => {
    const hostile = throwing({ messages: [] });
    const unreadable = throwing({});
    expect(transformHashOf('run-1', hostile)).toMatch(/^chain-v1:[0-9a-f]{16}$/);
    expect(transformHashOf('run-1', hostile)).toBe(transformHashOf('run-1', unreadable));
  });
});

describe('transformHashOf — the receipt claim, recomputable', () => {
  it('CONTRACT: recomputes cache.transformHash from the request the strategy returned', () => {
    for (const input of receiptInputs(11)) {
      const receipt = buildReceipt(input, createReceiptDigests());
      if (receipt.cache.transform !== 'rewritten') continue;
      expect(receipt.cache.transformHash).toBe(transformHashOf('run-7', input.preparedRequest));
      expect(receipt.cache.transformHash!.startsWith(TRANSFORM_HASH_PREFIX)).toBe(true);
    }
  });

  it('CONTRACT: the scheme is named in the value; a bare value is the older whole-request digest', () => {
    const request = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
    const chained = transformHashOf('run-1', request);
    expect(chained).toMatch(/^chain-v1:[0-9a-f]{16}$/);
    // What a receipt minted before the prefix carries — and how it verifies.
    const legacy = receiptHash('run-1', stableJson(request)!);
    expect(legacy).toMatch(/^[0-9a-f]{16}$/);
    expect(legacy).not.toBe(chained.slice(TRANSFORM_HASH_PREFIX.length));
    // A different message order is a different fingerprint.
    const swapped = { ...request, messages: [{ role: 'user', content: 'b' }, ...request.messages] };
    expect(transformHashOf('run-1', swapped)).not.toBe(chained);
  });
});

// ── Work counts on a real agent run ─────────────────────────────────────────

const ROWS = 200;
const rowsTool = defineTool<{ k: number }, unknown>({
  name: 'rows',
  description: 'returns rows',
  inputSchema: { type: 'object', properties: { k: { type: 'number' } } },
  execute: (args) =>
    Array.from({ length: ROWS }, (_, i) => ({ id: i, name: `row-${args.k}-${i}`, v: i % 13 })),
});

async function mintWork(iterations: number) {
  meter.perMint = [];
  meter.shaChars = 0;
  meter.encodeChars = 0;
  const replies = [
    ...Array.from({ length: iterations }, (_, i) => ({
      toolCalls: [{ id: `c${i + 1}`, name: 'rows', args: { k: i + 1 } }],
    })),
    { content: 'done' },
  ];
  const provider = mock({ replies });
  // Declare caching, so the strategy rewrites the request and the transform
  // fingerprint is minted on every call — the heaviest path.
  Object.assign(provider, {
    promptCaching: { mode: 'breakpoints', maxBreakpoints: 4, reportsUsage: false },
  });
  const agent = Agent.create({ provider, model: 'm', maxIterations: iterations + 5 })
    .tools([rowsTool])
    .build();
  const encode = TextEncoder.prototype.encode;
  const spy = vi
    .spyOn(TextEncoder.prototype, 'encode')
    .mockImplementation(function (this: TextEncoder, input?: string) {
      if (meter.minting) meter.encodeChars += input?.length ?? 0;
      return encode.call(this, input);
    });
  try {
    await agent.run({ message: 'go' });
  } finally {
    spy.mockRestore();
  }
  return {
    sha: meter.shaChars,
    encode: meter.encodeChars,
    mints: [...meter.perMint],
  };
}

describe('the mint does work in proportion to what each call added', () => {
  it('WORK COUNT: flat per call, ~4× for 4× the iterations (was ~16×)', async () => {
    const small = await mintWork(6);
    const large = await mintWork(24);
    expect(large.mints.length).toBe(25);
    expect(large.mints.some((m) => m.transform === 'rewritten')).toBe(true);

    // Per call: once the loop is running, each call hashes and encodes about
    // one tool result's worth — the last call no more than the second.
    const steady = large.mints.slice(1, -1);
    const most = (key: 'sha' | 'encode') => Math.max(...steady.map((m) => m[key]));
    const least = (key: 'sha' | 'encode') => Math.min(...steady.map((m) => m[key]));
    expect(most('sha')).toBeLessThan(least('sha') * 1.5);
    expect(most('encode')).toBeLessThan(least('encode') * 1.5);

    // The whole run: linear in the iterations.
    expect(large.sha / small.sha).toBeGreaterThan(3);
    expect(large.sha / small.sha).toBeLessThan(5);
    expect(large.encode / small.encode).toBeGreaterThan(3);
    expect(large.encode / small.encode).toBeLessThan(5);
  });
});
