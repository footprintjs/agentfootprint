/**
 * recordingPack — a recording with every repeated value written once.
 *
 * Test types:
 *   - LAW         — `JSON.stringify(unpack(parse(stringify(pack(r)))))` is
 *                   `toWireJson(r)`, byte for byte: a real agent recording, and
 *                   a hand-built one with every value JSON treats specially
 *                   (`toJSON`, Errors under the wire rule, `undefined`,
 *                   functions, non-finite numbers, boxed primitives,
 *                   `__proto__`, shared objects and structural copies).
 *   - INJECTIVE   — a recording whose own data looks like a reference or an
 *                   escape reads back as itself.
 *   - REFUSAL     — a packed format this reader does not know, a dangling or
 *                   self reference: refused by name, never half-read. What
 *                   JSON refuses (a cycle, a BigInt) the packer refuses too.
 *   - READERS     — `unpackRecording` hands a plain recording back untouched;
 *                   `openRecording` and an Agent's packed artifact mint read
 *                   back as the plain recording.
 *   - WORK COUNT  — on a real agent run with 200-row tool results, 4× the
 *                   iterations cost ~4× the packed bytes and under 6× the
 *                   packer's reads; the plain recording grows ~16× (9.5× at
 *                   these sizes, where the fixed part still weighs in).
 *   - BOUND       — a packed recording is expanded only when the plain
 *                   recording it stands for is within `maxBytes`: a few KB
 *                   that stand for 10^40 bytes (values referring ten times to
 *                   values referring ten times…) are refused after reading the
 *                   packed form ONCE and expanding nothing — counted, not
 *                   timed; the measure is exact to the byte (a real recording
 *                   with multi-byte text passes at its plain size and is
 *                   refused one byte below); a plain recording is untouched.
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../../src/index.js';
import type { AgentfootprintEvent } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import {
  DEFAULT_UNPACK_MAX_BYTES,
  isPackedRecording,
  packRecording,
  PACKED_RECORDING_FORMAT,
  PackedRecordingError,
  PackedRecordingTooLargeError,
  recordRun,
  unpackRecording,
} from '../../../src/observe.js';
import { openRecording } from '../../../src/debug.js';
import { packCounted, unpackCounted } from '../../../src/recorders/observability/recordingPack.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { toWireJson } from '../../../src/lib/wireJson.js';

const roundTrip = (recording: unknown): string =>
  JSON.stringify(
    unpackRecording(JSON.parse(JSON.stringify(packRecording(recording as Recording)))),
  );

const rowsTool = (rows: number, label = 'row') =>
  defineTool<{ k: number }, unknown>({
    name: 'rows',
    description: 'returns rows',
    inputSchema: { type: 'object', properties: { k: { type: 'number' } } },
    execute: (args) =>
      Array.from({ length: rows }, (_, i) => ({
        id: i,
        name: `${label}-${args.k}-${i}`,
        v: i % 13,
      })),
  });

async function agentRecording(
  iterations: number,
  rows: number,
  label?: string,
): Promise<Recording> {
  const replies = [
    ...Array.from({ length: iterations }, (_, i) => ({
      toolCalls: [{ id: `c${i + 1}`, name: 'rows', args: { k: i + 1 } }],
    })),
    { content: 'done' },
  ];
  const agent = Agent.create({
    provider: mock({ replies }),
    model: 'm',
    maxIterations: iterations + 5,
  })
    .tools([rowsTool(rows, label)])
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'go' });
  recorder.stop();
  return recorder.toRecording();
}

describe('packRecording — the law', () => {
  it('LAW: a real agent recording reads back as its plain wire JSON, byte for byte', async () => {
    const recording = await agentRecording(4, 50);
    const packed = packRecording(recording);
    expect(packed.format).toBe(PACKED_RECORDING_FORMAT);
    expect(packed.values.length).toBeGreaterThan(0);
    expect(roundTrip(recording)).toBe(toWireJson(recording));
  });

  it('LAW: every value JSON treats specially, and the wire rule for Errors', () => {
    const shared = { note: 'the same object, referred to twice', pad: 'x'.repeat(80) };
    const copy = JSON.parse(JSON.stringify(shared)) as typeof shared;
    const long = 'y'.repeat(200);
    const cause = new Error('inner');
    const error = Object.assign(new Error('outer', { cause }), { code: 'E_OUTER' });
    const protoKey = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as object;
    const recording = {
      snapshot: {
        when: new Date(0),
        shared,
        again: shared,
        copy,
        long,
        longAgain: long,
        nested: [shared, copy, { long }],
        absent: undefined,
        fn: () => 1,
        numbers: [NaN, Infinity, -0, 1.5],
        boxed: [new Number(3), new String('s'), new Boolean(false)],
        // Inherits from Number.prototype but has no number inside: an object.
        lookalike: Object.assign(Object.create(Number.prototype) as object, { x: 1 }),
        holes: [1, , 3], // eslint-disable-line no-sparse-arrays
        protoKey,
        custom: { toJSON: () => ({ made: 'by toJSON', pad: 'z'.repeat(70) }) },
        customAgain: { toJSON: () => ({ made: 'by toJSON', pad: 'z'.repeat(70) }) },
      },
      events: [
        { type: 'a', payload: { error } },
        { type: 'b', payload: { error } },
      ],
      structure: null,
    };
    expect(roundTrip(recording)).toBe(toWireJson(recording));
    // `__proto__` is read back as an own key, never as the prototype.
    const back = unpackRecording(
      JSON.parse(JSON.stringify(packRecording(recording as never))),
    ) as unknown as { snapshot: { protoKey: object } };
    expect(Object.getPrototypeOf(back.snapshot.protoKey)).toBe(Object.prototype);
    expect(Object.keys(back.snapshot.protoKey)).toEqual(['__proto__', 'ok']);
  });

  it('a recording with nothing repeated packs to its own JSON plus the envelope', () => {
    const recording = { snapshot: { a: 1 }, events: [{ type: 'x' }], structure: {} };
    const packed = packRecording(recording as never);
    expect(packed.values).toEqual([]);
    expect(packed.recording).toEqual(recording);
  });
});

describe('packRecording — injective', () => {
  it('INJECTIVE: data that looks like a reference or an escape reads back as itself', () => {
    const recording = {
      snapshot: {
        ref: { '$af:ref': 0 },
        esc: { '$af:esc': { a: 1 } },
        escScalar: { '$af:esc': 5 },
        both: { '$af:ref': 1, other: 'x'.repeat(70) },
        repeated: [
          { '$af:ref': 2, pad: 'p'.repeat(70) },
          { '$af:ref': 2, pad: 'p'.repeat(70) },
        ],
      },
      events: [],
      structure: null,
    };
    expect(roundTrip(recording)).toBe(toWireJson(recording));
  });
});

describe('unpackRecording — refusals', () => {
  it('REFUSAL: a packed format this reader does not know is refused by name', () => {
    const future = { format: 'agentfootprint.recording.packed.v2', values: [], recording: {} };
    expect(() => unpackRecording(future)).toThrow(PackedRecordingError);
    expect(() => unpackRecording(future)).toThrow(/packed\.v2/);
  });

  it('REFUSAL: a reference to a value the recording does not hold, or to itself', () => {
    const dangling = { format: PACKED_RECORDING_FORMAT, values: [], recording: { '$af:ref': 3 } };
    expect(() => unpackRecording(dangling)).toThrow(PackedRecordingError);
    const selfRef = {
      format: PACKED_RECORDING_FORMAT,
      values: [{ again: { '$af:ref': 0 } }],
      recording: { '$af:ref': 0 },
    };
    expect(() => unpackRecording(selfRef)).toThrow(/refers to itself/);
  });

  it('REFUSAL: what JSON refuses, the packer refuses — a cycle, a BigInt', () => {
    const cyclic: Record<string, unknown> = { pad: 'c'.repeat(70) };
    cyclic.self = cyclic;
    expect(() => packRecording({ snapshot: cyclic } as never)).toThrow(TypeError);
    expect(() => packRecording({ snapshot: { n: 1n } } as never)).toThrow(TypeError);
    // A boxed BigInt too — JSON reads the box by its internal slot.
    expect(() => JSON.stringify({ n: Object(1n) })).toThrow(TypeError);
    expect(() => packRecording({ snapshot: { n: Object(1n) } } as never)).toThrow(TypeError);
  });
});

describe('readers', () => {
  it('READERS: a plain recording passes through unpackRecording untouched', () => {
    const plain = { snapshot: {}, events: [], structure: null };
    expect(unpackRecording(plain)).toBe(plain);
    expect(isPackedRecording(plain)).toBe(false);
    expect(isPackedRecording(packRecording(plain as never))).toBe(true);
  });

  it('READERS: openRecording reads a packed recording as the plain one', async () => {
    const recording = await agentRecording(3, 20);
    const plain = openRecording(JSON.parse(toWireJson(recording)));
    const packed = openRecording(JSON.parse(JSON.stringify(packRecording(recording))));
    expect(JSON.stringify(packed.snapshot)).toBe(JSON.stringify(plain.snapshot));
    expect(packed.narrative).toEqual(plain.narrative);
    expect(packed.events).toEqual(plain.events);
  });

  it('READERS: an Agent with recordings { packed: true } mints the packed text', async () => {
    const store = inMemoryArtifacts();
    const scope = { conversationId: 'packed' };
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'c1', name: 'rows', args: { k: 1 } }] }, { content: 'ok' }],
      }),
      model: 'm',
      artifacts: { store, recordings: { packed: true } },
    })
      .tools([rowsTool(20)])
      .build();
    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) => minted.push(e));
    expect(await agent.run({ message: 'go', identity: scope })).toBe('ok');
    const ref = (minted[0] as { payload?: { ref?: string } }).payload?.ref as string;
    const record = await store.get(scope, ref);
    const stored = JSON.parse(record?.data as string) as unknown;
    expect(isPackedRecording(stored)).toBe(true);
    const back = unpackRecording(stored) as unknown as Record<string, unknown>;
    expect(Object.keys(back).sort()).toEqual(['events', 'snapshot', 'structure']);
  });
});

describe('the packed recording grows with the run, not its square', () => {
  it('WORK COUNT: 4× the iterations — ~4× the packed bytes and the reads; plain grew ~16×', async () => {
    const measure = async (iterations: number) => {
      const recording = await agentRecording(iterations, 200);
      const work = { members: 0 };
      const packed = JSON.stringify(packCounted(recording, work));
      return { plain: toWireJson(recording).length, packed: packed.length, reads: work.members };
    };
    const small = await measure(5);
    const large = await measure(20);
    // Measured 3.9× — each repeated value is written once.
    expect(large.packed / small.packed).toBeLessThan(4.5);
    // Measured 4.7×. Not 4×: what the packer must READ is the in-memory
    // recording, which holds each iteration's own context records (one per
    // history message, re-written every call — equal content, new objects)
    // and every re-announcement's envelope. Packing writes those once; it
    // cannot avoid reading them. That term is small and bounded here.
    expect(large.reads / small.reads).toBeLessThan(6);
    // The problem it solves, measured on the same runs (9.5×).
    expect(large.plain / small.plain).toBeGreaterThan(8);
  }, 60_000);
});

describe('the answer-account step reads a packed recording', () => {
  it('READERS: explainRecording over the packed text equals it over the plain text', async () => {
    const { explainRecording } = await import('../../../src/hosting/answerAccounts.js');
    const recording = await agentRecording(2, 20);
    const plain = explainRecording({ data: toWireJson(recording) }, {});
    const packed = explainRecording({ data: JSON.stringify(packRecording(recording)) }, {});
    expect(plain).not.toBeNull();
    expect(packed).toEqual(plain);
  });
});

// ── The expansion bound ─────────────────────────────────────────────────────

/**
 * A packed recording a few KB long that stands for 10^`depth` copies of a
 * 100-character string: value k is ten references to value k−1. Built as a
 * file would arrive — parsed from its JSON text, every reference its own object.
 */
function amplification(depth: number): unknown {
  const values: unknown[] = ['x'.repeat(100)];
  for (let k = 1; k <= depth; k++) {
    values.push(Array.from({ length: 10 }, () => ({ '$af:ref': k - 1 })));
  }
  return JSON.parse(
    JSON.stringify({
      format: PACKED_RECORDING_FORMAT,
      values,
      recording: { snapshot: { '$af:ref': depth }, events: [], structure: null },
    }),
  );
}

/** Every node of a parsed JSON value — the packed form's own size, in nodes. */
function nodesOf(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1;
  return 1 + Object.values(value).reduce((sum: number, child) => sum + nodesOf(child), 0);
}

/** UTF-8 bytes of the plain recording's wire JSON — what a plain mint would store. */
const plainBytes = (recording: unknown): number => Buffer.byteLength(toWireJson(recording), 'utf8');

describe('unpackRecording — the expansion bound', () => {
  it('BOUND: a few KB standing for 10^40 copies is refused — the packed form read once, nothing expanded', () => {
    for (const depth of [20, 40]) {
      const payload = amplification(depth);
      expect(JSON.stringify(payload).length).toBeLessThan(10_000);
      const work = { measured: 0, decoded: 0 };
      expect(() => unpackCounted(payload, { maxBytes: 16 * 1024 * 1024 }, work)).toThrow(
        PackedRecordingTooLargeError,
      );
      // The work is the PACKED size, whatever the expansion: at most one read
      // per packed node, and not one node built.
      expect(work.measured).toBeLessThanOrEqual(nodesOf(payload));
      expect(work.decoded).toBe(0);
    }
  });

  it('BOUND: the default bound refuses it too, and the refusal is a PackedRecordingError by name', () => {
    expect(DEFAULT_UNPACK_MAX_BYTES).toBe(512 * 1024 * 1024);
    let caught: unknown;
    try {
      unpackRecording(amplification(30));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PackedRecordingTooLargeError);
    expect(caught).toBeInstanceOf(PackedRecordingError);
    expect((caught as PackedRecordingTooLargeError).maxBytes).toBe(DEFAULT_UNPACK_MAX_BYTES);
    // openRecording reads through the same default.
    expect(() => openRecording(amplification(30) as never)).toThrow(PackedRecordingTooLargeError);
  });

  it('BOUND: exact to the byte — a real recording with multi-byte text passes at its plain size, and not one byte under', async () => {
    const recording = await agentRecording(3, 20, 'rów😀');
    const exact = plainBytes(recording);
    const packed = JSON.parse(JSON.stringify(packRecording(recording))) as unknown;
    expect(JSON.stringify(unpackRecording(packed, { maxBytes: exact }))).toBe(
      toWireJson(recording),
    );
    expect(() => unpackRecording(packed, { maxBytes: exact - 1 })).toThrow(
      PackedRecordingTooLargeError,
    );
  });

  it('BOUND: exact for what only an in-memory packed value can hold — undefined, holes, functions, shared nodes', () => {
    const shared = { note: 'é'.repeat(10) };
    const packed = {
      format: PACKED_RECORDING_FORMAT,
      values: [{ a: undefined, b: [1, , undefined, () => 1], c: () => 1, d: NaN, e: shared }], // eslint-disable-line no-sparse-arrays
      recording: { snapshot: { x: { '$af:ref': 0 }, y: { '$af:ref': 0 }, z: shared }, events: [] },
    };
    const exact = Buffer.byteLength(
      JSON.stringify(unpackRecording(packed, { maxBytes: Infinity })),
      'utf8',
    );
    expect(() => unpackRecording(packed, { maxBytes: exact })).not.toThrow();
    expect(() => unpackRecording(packed, { maxBytes: exact - 1 })).toThrow(
      PackedRecordingTooLargeError,
    );
  });

  it('BOUND: a plain recording is returned untouched — its bound is the text it was parsed from', () => {
    const plain = { snapshot: { long: 'p'.repeat(1_000) }, events: [], structure: null };
    expect(unpackRecording(plain, { maxBytes: 0 })).toBe(plain);
  });

  it('BOUND: a bound that is not a byte count is refused by name', () => {
    for (const bad of [-1, Number.NaN, '16' as unknown as number]) {
      expect(() => unpackRecording({}, { maxBytes: bad })).toThrow(/maxBytes/);
    }
  });
});
