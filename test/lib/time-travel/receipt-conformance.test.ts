/**
 * THE CONFORMANCE LAW — hash(servedAt(k)) === receiptAt(k).hash, on real runs.
 *
 * Every run here is a real agent driven by a real provider stub: a chart is
 * built, stages execute, commits land, and the request the provider was handed
 * is captured verbatim at the moment of the call. Nothing is hand-built,
 * because the claim under test is precisely that a rebuild from the RECORD
 * agrees with what went out — and a fixture log would let the rebuild agree
 * with a fiction.
 *
 * Three things are checked at every llm-turn stop of every run:
 *
 *   1. the RECEIPT describes the WIRE   — the request the provider actually
 *      received hashes to the receipt's hashes;
 *   2. the SERVED VIEW rebuilds it      — `servedAt(k)`, folded from committed
 *      pieces alone, hashes to the same values;
 *   3. every receipt field neither could prove is NAMED in `servedAt(k).gaps`.
 *
 * Five real divergences between the committed pieces and the sent request were
 * found by running this and every one of them was closed by committing a fact
 * or declaring a gap. None was closed by loosening an assertion, and the
 * mutation test at the bottom is what keeps that honest: drop one committed
 * piece from the replay and the law must go red naming the epoch and the field.
 *
 * ── A STATED LIMIT: THE '@wire' CLAUSES ARE NOT AN INDEPENDENT WITNESS ─────
 * The clauses marked `@wire` below compare the receipt against the request the
 * provider stub really received. That catches a rebuild that drifts from the
 * request, and it catches a receipt that describes something the provider never
 * got. It does NOT catch a defect in the shared assembly: the receipt and the
 * request are minted from the SAME locals inside `callLLM`, a few lines apart,
 * so a change that alters both symmetrically — a rule applied to `wireMessages`
 * and to the receipt's `messages` alike — leaves every `@wire` clause green.
 *
 * A genuinely independent witness would have to come from OUTSIDE the process
 * that composed the request: a recorded HTTP body from a real adapter, or a
 * second implementation of the assembly written against the vendor's own
 * schema and diffed against ours. Neither exists here, and inventing one in
 * this pass would trade a stated limit for a hidden one. The limit is stated;
 * the honest reading of a green `@wire` clause is "the receipt agrees with what
 * this process handed the provider", not "the receipt agrees with the wire".
 *
 * Test types (Convention 3): unit (the digest primitive against `node:crypto`,
 * the message digest's join keys — id AND name — and signatures) / functional
 * (the law in both chart shapes, and across a pause/resume) / integration
 * (skill hop, steps, a parked map, wrap-up, tool-forced, staged refs, a cache
 * that rewrites the composition and one that rewrites a sampling dial,
 * parallel tool results, an `LLMCall` chart) / regression (a pre-9.88
 * recording, the receipt's own laws, a reader that tries to edit what it was
 * handed) / edge (no fold base on either of the two folds, no run log, an
 * unserializable request, the off switch, what a recording actually contains).
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  epochLocations,
  flowchartAsTool,
  inMemoryArtifacts,
  LLMCall,
  receiptAt,
  receiptHash,
  servedAt,
  servedViews,
  toolDigestInput,
  RECEIPT_BOUNDARY,
  SERVED_GAPS,
  UNGAPPED_FIELDS,
  type Receipt,
  type ServedGapKind,
  type ServedView,
} from '../../../src/index.js';
import { flowChart, FlowChartExecutor, type FlowChart } from 'footprintjs';
import { buildMessageApiChart } from '../../../src/core/agent/buildMessageApiChart.js';
import { buildAgentMessageApiChart } from '../../../src/core/agent/buildAgentMessageApiChart.js';
import { innerRunsOf } from '../../../src/lib/trace-toolpack/index.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import {
  buildReceipt,
  messageDigestInput,
  sha256Hex,
  stableJson,
} from '../../../src/lib/time-travel/index.js';
import { stepOutputText } from '../../../src/lib/context-bisect/index.js';
import type {
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
} from '../../../src/adapters/types.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;

interface Run {
  readonly snapshot: Snapshot;
  /** Every request the provider was handed, verbatim, in call order. */
  readonly wire: readonly LLMRequest[];
}

/** A provider that answers from a script and keeps every request it saw. */
function scripted(script: readonly Reply[]) {
  const wire: LLMRequest[] = [];
  let i = 0;
  return {
    wire,
    provider: {
      name: 'conformance-mock',
      // The forced-tool-choice capability, declared so the `'tool-forced'`
      // scenario below can be built at all — the door refuses a provider that
      // does not promise the wire.
      carriesForcedToolChoice: true,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        // JSON round-trip, not structuredClone: `req.messages` can be a live
        // TypedScope proxy view, which structuredClone refuses.
        wire.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

const answer = (content: string): Reply => ({ content });
const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

// ─── the law, as a function that names its failures ──────────────────

/** One broken clause of the law: which epoch, which receipt field, what
 *  disagreed. Kept as DATA so the mutation test can assert on it. */
interface Failure {
  readonly epoch: number;
  readonly field: string;
  readonly detail: string;
}

/** Does any gap in `gaps` name `field`? Dotted `Receipt` paths, with `a.b[x]`
 *  matching a gap that named `a.b`. */
const named = (gaps: readonly ServedView['gaps'][number][], field: string): boolean =>
  gaps.some((g) => g.fields.some((f) => field === f || field.startsWith(`${f}[`)));

/** The gap catalogue's fields, as the law reads them: a receipt field named
 *  by a gap is one the rebuild is EXCUSED from proving. */
const excusedBy = (view: ServedView, field: string): boolean => named(view.gaps, field);

/**
 * The gaps that can excuse a receipt row the rebuild could not produce AT ALL
 * — a narrower question than {@link excusedBy}, and it needs its own list.
 *
 * `SERVED_GAPS` entries cover two different relations. Most say *the rebuild
 * cannot produce this*. `cache-transform` says something else: the rebuild
 * DOES produce these fields and they DO agree with the receipt, but both
 * describe the request handed TO the cache strategy rather than the one the
 * port got. That is a caveat a renderer must show beside `system.text`, which
 * is why the composition fields belong on its list — and it is on EVERY view,
 * so letting it answer "is this missing row explained?" would make the clause
 * below permanently green. Two relations, one list, so the narrow question
 * names the gaps that can answer it.
 */
const MISSING_ROW_GAPS: readonly ServedGapKind[] = [
  'forced-tool-schema',
  'no-fold-base',
  'no-run-log',
  'no-conversation-on-record',
];
const missingRowExplained = (view: ServedView, field: string): boolean =>
  named(
    view.gaps.filter((g) => MISSING_ROW_GAPS.includes(g.gap)),
    field,
  );

/**
 * Check one epoch three ways and return every clause that broke.
 *
 * `request` is the wire witness — the request the provider really received.
 * It is omitted only where a cache strategy legitimately rewrote it, which is
 * the one case the receipt itself declares (`cache.transformHash`).
 */
function failuresAt(snapshot: Snapshot, epoch: number, request: LLMRequest | undefined): Failure[] {
  const out: Failure[] = [];
  const note = (field: string, detail: string): void => out.push({ epoch, field, detail });

  const receipt = receiptAt(snapshot, epoch);
  const view = servedAt(snapshot, epoch);
  if (receipt === undefined) return [{ epoch, field: 'receipt', detail: 'no receipt committed' }];
  if (view === undefined) return [{ epoch, field: 'served', detail: 'no view rebuildable' }];

  const hash = (content: string): string => receiptHash(receipt.basis.runId, content);

  // ── basis ────────────────────────────────────────────────────────────
  if (receipt.basis.epoch !== epoch) note('basis.epoch', `${receipt.basis.epoch} != ${epoch}`);
  if (view.epoch !== epoch) note('epoch', `${view.epoch} != ${epoch}`);

  // ── system: rebuild, then wire ───────────────────────────────────────
  if (hash(view.system.text) !== receipt.system.hash) {
    note('system.hash', `rebuild ${hash(view.system.text)} != receipt ${receipt.system.hash}`);
  }
  if (receipt.system.chars !== view.system.text.length) {
    note('system.chars', `${receipt.system.chars} != ${view.system.text.length}`);
  }
  if (receipt.system.pieces.length !== view.system.pieces.length) {
    note('system.pieces', `${receipt.system.pieces.length} != ${view.system.pieces.length}`);
  } else {
    view.system.pieces.forEach((piece, i) => {
      const on = receipt.system.pieces[i]!;
      if (on.hash !== hash(piece.text)) note(`system.pieces[${i}].hash`, 'piece hash differs');
      if (on.slot !== piece.slot) note(`system.pieces[${i}].slot`, `${on.slot} != ${piece.slot}`);
      if (on.source !== piece.source) note(`system.pieces[${i}].source`, 'source differs');
    });
  }
  if (request !== undefined && hash(request.systemPrompt ?? '') !== receipt.system.hash) {
    note('system.hash@wire', 'the receipt does not describe the string the provider got');
  }

  // ── messages: rebuild, then wire ─────────────────────────────────────
  const rebuilt = [
    ...view.messages.asSent,
    ...view.messages.requestOnly.map(
      (line): LLMMessage => ({ role: line.role, content: line.text } as LLMMessage),
    ),
  ];
  if (receipt.messages.count !== rebuilt.length) {
    note('messages.count', `${receipt.messages.count} != ${rebuilt.length}`);
  }
  if (receipt.messages.entries.length !== view.messages.asSent.length) {
    note(
      'messages.entries',
      `${receipt.messages.entries.length} != ${view.messages.asSent.length}`,
    );
  } else {
    view.messages.asSent.forEach((message, i) => {
      const on = receipt.messages.entries[i]!;
      if (on.role !== message.role) note(`messages.entries[${i}].role`, 'role differs');
      if (on.hash !== hash(messageDigestInput(message))) {
        note(`messages.entries[${i}].hash`, 'message hash differs');
      }
    });
  }
  if (receipt.messages.requestOnly.length !== view.messages.requestOnly.length) {
    note(
      'messages.requestOnly',
      `${receipt.messages.requestOnly.length} != ${view.messages.requestOnly.length}`,
    );
  } else {
    view.messages.requestOnly.forEach((line, i) => {
      const on = receipt.messages.requestOnly[i]!;
      if (on.reason !== line.reason) note(`messages.requestOnly[${i}].reason`, 'reason differs');
      if (on.hash !== hash(messageDigestInput({ role: line.role, content: line.text }))) {
        note(`messages.requestOnly[${i}].hash`, 'request-only hash differs');
      }
    });
  }
  if (request !== undefined) {
    const sent = request.messages ?? [];
    if (sent.length !== rebuilt.length) {
      note('messages@wire', `${sent.length} on the wire, ${rebuilt.length} rebuilt`);
    } else {
      const onReceipt = [...receipt.messages.entries, ...receipt.messages.requestOnly];
      sent.forEach((message, i) => {
        if (onReceipt[i]!.hash !== hash(messageDigestInput(message))) {
          note(`messages@wire[${i}]`, 'the receipt does not describe the turn that went out');
        }
      });
    }
  }

  // ── tools: names, forced, withheld, schema hashes ────────────────────
  if (stableJson(receipt.tools.names) !== stableJson(view.tools.names)) {
    note('tools.names', `${receipt.tools.names.join()} != ${view.tools.names.join()}`);
  }
  if (receipt.tools.forced !== (view.tools.forced ?? null)) {
    note('tools.forced', `${receipt.tools.forced} != ${view.tools.forced ?? null}`);
  }
  if (receipt.tools.withheld !== (view.tools.withheld ?? null)) {
    note('tools.withheld', `${receipt.tools.withheld} != ${view.tools.withheld ?? null}`);
  }
  for (const schema of view.tools.schemas) {
    if (receipt.tools.schemaHashes[schema.name] !== hash(toolDigestInput(schema))) {
      note(`tools.schemaHashes[${schema.name}]`, 'schema hash differs');
    }
  }
  // A name the receipt hashes and the rebuild cannot: excused only by a gap.
  const rebuiltNames = new Set(view.tools.schemas.map((s) => s.name));
  for (const name of Object.keys(receipt.tools.schemaHashes)) {
    if (!rebuiltNames.has(name) && !missingRowExplained(view, `tools.schemaHashes[${name}]`)) {
      note(`tools.schemaHashes[${name}]`, 'hashed by the receipt, unrebuildable, ungapped');
    }
  }
  if (request !== undefined) {
    const sent = (request.tools ?? []).map((t) => t.name);
    if (stableJson(sent) !== stableJson(receipt.tools.names)) {
      note(
        'tools.names@wire',
        `${sent.join()} on the wire, ${receipt.tools.names.join()} recorded`,
      );
    }
  }

  // ── the join key that pairs a tool result to its call ────────────────
  // Two parallel calls can return byte-identical text; without the id on the
  // digest they hash the same and a mis-pairing is invisible.
  view.messages.asSent.forEach((message, i) => {
    const on = receipt.messages.entries[i];
    if (on === undefined) return;
    if ((on.key ?? undefined) !== (message.toolCallId ?? undefined)) {
      note(`messages.entries[${i}].key`, `${on.key} != ${message.toolCallId}`);
    }
  });

  // ── the sampling knobs (@wire — see the stated limit in the header) ───
  if (request !== undefined) {
    const knobs: [string, unknown, unknown][] = [
      ['params.temperature', receipt.params.temperature, request.temperature],
      ['params.maxTokens', receipt.params.maxTokens, request.maxTokens],
      ['params.thinkingBudget', receipt.params.thinkingBudget, request.thinking?.budget],
      ['params.stop', stableJson(receipt.params.stop), stableJson(request.stop)],
      ['params.toolChoice', stableJson(receipt.params.toolChoice), stableJson(request.toolChoice)],
    ];
    for (const [field, onReceipt, onWire] of knobs) {
      if (onReceipt !== onWire) note(`${field}@wire`, `${String(onReceipt)} != ${String(onWire)}`);
    }
  }

  // ── the cache transform: unrebuildable BY CONSTRUCTION, always gapped ─
  if (!excusedBy(view, 'cache.transformHash')) {
    note('cache.transformHash', 'a rewritten request is not derivable from the log, and ungapped');
  }
  // …and so is which of the candidate markers the strategy actually applied.
  if (!excusedBy(view, 'cache.markersApplied')) {
    note(
      'cache.markersApplied',
      'the applied breakpoints are not derivable from the log, ungapped',
    );
  }
  // Every marker it DID record is three scalars and nothing else.
  receipt.cache.markersApplied.forEach((marker, i) => {
    if (stableJson(Object.keys(marker).sort()) !== stableJson(['boundaryIndex', 'field', 'ttl'])) {
      note(`cache.markersApplied[${i}]`, `carries ${Object.keys(marker).join()}`);
    }
  });

  return out;
}

/** The law over a whole run. `wireOf` maps epoch → the request the provider
 *  got, or `undefined` when a cache strategy legitimately rewrote it. */
function failures(run: Run, opts: { wire?: boolean } = {}): Failure[] {
  const views = servedViews(run.snapshot);
  expect(views.length).toBeGreaterThan(0);
  return views.flatMap((view, i) =>
    failuresAt(run.snapshot, view.epoch, opts.wire === false ? undefined : run.wire[i]),
  );
}

const clean = (run: Run, opts?: { wire?: boolean }): void => {
  expect(failures(run, opts)).toEqual([]);
};

/**
 * A detached copy of a recording with one state key removed from EVERY log it
 * holds — the run's own and every subflow subtree's — plus from each of their
 * fold bases. The shape of "the run never committed this", made from a real
 * run rather than hand-built, so what is left is otherwise genuine.
 */
function stripKey<T>(recording: T, key: string): T {
  type Bundle = { trace: { path: string }[]; overwrite: Record<string, unknown> };
  type Log = { commitLog?: Bundle[]; history?: Bundle[]; initialState?: Record<string, unknown> };
  const copy = JSON.parse(JSON.stringify(recording)) as T & {
    subflowResults?: Record<string, { treeContext?: Log }>;
  };
  const scrub = (log: Log | undefined): void => {
    if (!log) return;
    for (const bundle of [...(log.commitLog ?? []), ...(log.history ?? [])]) {
      bundle.trace = bundle.trace.filter((t) => t.path !== key);
      delete bundle.overwrite[key];
    }
    if (log.initialState) delete log.initialState[key];
  };
  scrub(copy as Log);
  for (const entry of Object.values(copy.subflowResults ?? {})) scrub(entry?.treeContext);
  return copy;
}

// ─── the runs ────────────────────────────────────────────────────────

type ReactMode = 'dynamic' | 'dynamic-grouped';

async function run(
  reactMode: ReactMode,
  script: readonly Reply[],
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  options: { maxIterations?: number } = {},
): Promise<Run> {
  const { provider, wire } = scripted(script);
  const agent = build(
    Agent.create({
      provider: provider as never,
      model: 'mock',
      maxIterations: options.maxIterations ?? 6,
      reactMode,
    }),
  ).build();
  await agent.run({ message: 'go' });
  return { snapshot: agent.getSnapshot()!, wire };
}

const TOOL_THEN_DONE = [call('c1', 'alpha_tool'), answer('done')];

const graphOf = () =>
  skillGraph({
    skills: [
      defineSkill({
        id: 'alpha',
        description: 'alpha does things',
        body: 'ALPHA_BODY',
        tools: [tool('alpha_tool')],
      } as never),
      defineSkill({
        id: 'beta',
        description: 'beta does things',
        body: 'BETA_BODY',
        tools: [tool('beta_tool')],
      } as never),
    ],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });

// ─── (a) UNIT — the vendored digest is the real one ───────────────────

describe('the digest primitive', () => {
  it('agrees with node:crypto on every shape the receipt hashes', () => {
    const inputs = [
      '',
      'a',
      'the quick brown fox',
      'π ≈ 3.14159 — multibyte, and an emoji 🐛',
      'x'.repeat(55), // one byte short of a second block
      'x'.repeat(56), // the padding boundary
      'x'.repeat(64),
      'x'.repeat(1000),
    ];
    for (const input of inputs) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });

  it('the salt makes the same sentence hash differently in two runs', () => {
    const same = 'You are a helpful assistant.';
    expect(receiptHash('run-a', same)).not.toBe(receiptHash('run-b', same));
    expect(receiptHash('run-a', same)).toBe(receiptHash('run-a', same));
    expect(receiptHash('run-a', same)).toHaveLength(16);
  });

  it('stableJson sorts keys at every depth, so build order cannot fake a change', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

// ─── (b) FUNCTIONAL — the law in both chart shapes ────────────────────

describe('the law holds at every llm-turn stop', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: receipt describes the wire, and the log rebuilds it`, async () => {
      const r = await run(reactMode, TOOL_THEN_DONE, (a) =>
        a.system('you are a bot').tool(tool('alpha_tool')),
      );
      expect(servedViews(r.snapshot)).toHaveLength(2);
      expect(servedViews(r.snapshot).map((v) => v.epoch)).toEqual([1, 2]);
      clean(r);
    });

    it(`${reactMode}: a skill-graph hop changes the served pieces, and both sides follow`, async () => {
      const r = await run(reactMode, TOOL_THEN_DONE, (a) =>
        a.system('you are a bot').skillGraph(graphOf()),
      );
      const views = servedViews(r.snapshot);
      // The hop is visible in what was served: the body changed between turns.
      expect(views[0]!.system.text).toContain('ALPHA_BODY');
      expect(views[1]!.system.text).toContain('BETA_BODY');
      clean(r);
    });
  }
});

describe('a run that paused and resumed', () => {
  // A resume is a FRESH executor seeded from `checkpoint.sharedState`, so
  // everything the paused run had written is the resumed run's fold BASE, not
  // its log. A rebuild that folded the log alone reported an empty system
  // prompt and a one-message window for a call that really went out with the
  // whole prompt and the whole conversation — a confident falsehood, and no
  // gap. Under `'dynamic'` (where the turn commits to the run's own log) that
  // is exactly what happened; under `'dynamic-grouped'` the subflow's
  // inputMapper re-seeded the inner log and hid it. Both shapes are checked so
  // the fix cannot regress in the shape that was accidentally fine.
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: the epoch after the resume rebuilds the REAL prompt and window`, async () => {
      const { provider, wire } = scripted([call('c1', 'ask_human'), answer('done')]);
      const agent = Agent.create({ provider: provider as never, model: 'mock', reactMode })
        .system('SYSTEM_MARKER you are a bot')
        .tool({
          schema: { name: 'ask_human', description: 'ask', inputSchema: { type: 'object' } },
          execute: () => {
            pauseHere({ question: 'proceed?' });
            return '';
          },
        })
        .build();

      const paused = await agent.run({ message: 'go' });
      expect(isPaused(paused)).toBe(true);
      if (!isPaused(paused)) return;
      await agent.resume(paused.checkpoint, 'yes');

      // The resumed run's snapshot holds ONE epoch — the turn after the pause.
      const snapshot = agent.getSnapshot()!;
      const views = servedViews(snapshot);
      expect(views).toHaveLength(1);
      const view = views[0]!;
      const sent = wire[wire.length - 1]!;

      // The system prompt is the one the provider got, not an empty string.
      expect(view.system.text).toContain('SYSTEM_MARKER');
      expect(view.system.text).toBe(sent.systemPrompt);
      // …and the window is the whole window, not the one turn the log wrote.
      expect(view.messages.asSent).toHaveLength(sent.messages.length);
      expect(view.messages.asSent.map((m) => m.content)).toEqual(
        sent.messages.map((m) => m.content),
      );
      // The tool list survived the resume too — it is seeded state as well.
      expect(view.tools.names).toEqual((sent.tools ?? []).map((t) => t.name));
      // The base travelled, so nothing here is guessed and no base gap fires.
      expect(view.gaps.map((g) => g.gap)).not.toContain('no-fold-base');
      // And the full law, against the request the provider really received.
      expect(failuresAt(snapshot, view.epoch, sent)).toEqual([]);
    });
  }
});

// ─── (c) INTEGRATION — the shapes that bend the request ───────────────

describe('a stepped skill', () => {
  it('the tool list narrows step by step, and every narrowing is on the record', async () => {
    const stepped = skillGraph({
      skills: [
        defineSkill({
          id: 'refund',
          description: 'refunds',
          body: 'REFUND_BODY',
          tools: [tool('lookup'), tool('charge')],
          steps: [
            { tool: 'lookup', note: 'find the order first' },
            { tool: 'charge', note: 'refund the charge' },
          ],
        } as never),
      ],
      start: 'refund',
      steps: [],
      check: 'off',
    });
    const r = await run('dynamic', [call('c1', 'lookup'), answer('done'), answer('done')], (a) =>
      a.system('bot').skillGraph(stepped),
    );
    const views = servedViews(r.snapshot);
    // The step pointer moves, and the served tool list moves with it — a
    // per-epoch fact, rebuilt from what each epoch committed.
    expect(views[0]!.tools.names).toContain('lookup');
    expect(views[0]!.tools.names).not.toContain('charge');
    expect(views[1]!.tools.names).toContain('charge');
    expect(views[1]!.tools.names).not.toContain('lookup');
    // The steps banner is its own system piece, so the rebuild has to place it.
    expect(views[0]!.system.pieces.map((p) => p.source)).toContain('instructions');
    clean(r);
  });
});

describe('a parked map', () => {
  it('the kernel mounts and parks skills, and every turn still conforms', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('bot').skillGraph(graphOf()).maps({ renewalGrace: 1 }),
    );
    const views = servedViews(r.snapshot);
    // The kernel keeps the first skill mounted past the hop — two skill pieces
    // in the second turn's composed prompt, one in the first.
    const skillPieces = (v: ServedView): number =>
      v.system.pieces.filter((p) => p.source === 'skill').length;
    expect(skillPieces(views[0]!)).toBe(1);
    expect(skillPieces(views[1]!)).toBe(2);
    clean(r);
  });
});

describe('the wrap-up call', () => {
  it('the tools come off at assembly, and the receipt says WHY they are gone', async () => {
    // A model that only ever calls a tool runs out of budget; the last call is
    // the wrap-up, sent with no tools at all.
    const r = await run(
      'dynamic',
      [call('c1', 'alpha_tool'), call('c2', 'alpha_tool'), call('c3', 'alpha_tool')],
      (a) => a.system('bot').tool(tool('alpha_tool')),
      { maxIterations: 2 },
    );
    const views = servedViews(r.snapshot);
    const wrapUp = views.find((v) => v.tools.withheld === 'wrap-up');
    expect(wrapUp).toBeDefined();
    expect(wrapUp!.tools.names).toEqual([]);
    expect(receiptAt(r.snapshot, wrapUp!.epoch)!.tools.withheld).toBe('wrap-up');
    // Every OTHER turn had the tool — the withholding is a fact about one call.
    expect(views[0]!.tools.names).toEqual(['alpha_tool']);
    clean(r);
  });
});

describe('a tool-forced output', () => {
  it('the forced tool is NAMED from the record, and its schema body is a declared gap', async () => {
    const parse = (value: unknown): { ok: true; value: { ok: boolean } } => ({
      ok: true,
      value: value as { ok: boolean },
    });
    const { provider, wire } = scripted([
      { content: '', toolCalls: [{ id: '1', name: 'respond_with_schema', args: { ok: true } }] },
    ]);
    const agent = Agent.create({ provider: provider as never, model: 'mock' })
      .system('bot')
      .outputSchema({ safeParse: parse } as never, {
        strategy: 'tool-forced',
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      })
      .build();
    await agent.run({ message: 'go' });
    const r: Run = { snapshot: agent.getSnapshot()!, wire };

    const view = servedAt(r.snapshot, 1)!;
    const receipt = receiptAt(r.snapshot, 1)!;
    expect(view.tools.forced).toBe(receipt.tools.forced);
    expect(view.tools.forced).toBeTruthy();
    // The NAME rebuilds; the schema body does not, and says so.
    expect(view.tools.names).toContain(view.tools.forced!);
    expect(view.tools.schemas.map((s) => s.name)).not.toContain(view.tools.forced!);
    expect(view.gaps.map((g) => g.gap)).toContain('forced-tool-schema');
    clean(r);
  });
});

describe('the staged-refs nudge', () => {
  it('the one model-facing line written to no history rebuilds from committed state', async () => {
    const rows = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ vol: i, gb: 18 })));
    const exportRows = defineTool({
      name: 'export_rows',
      description: 'export the rows',
      resultKind: 'dataset/rows',
      execute: () => rows,
    });
    const compute = defineTool<{ dataset: string }, string>({
      name: 'compute',
      description: 'compute over a staged dataset',
      inputSchema: { type: 'object', properties: { dataset: { type: 'string' } } },
      wants: { dataset: 'dataset/rows' },
      execute: () => 'total: 3600',
    });
    const { provider, wire } = scripted([call('c1', 'export_rows'), answer('staged and computed')]);
    const agent = Agent.create({
      provider: provider as never,
      model: 'mock',
      maxIterations: 6,
      artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2000 } },
    })
      .system('You are a storage engineer.')
      .tool(exportRows)
      .tool(compute)
      .namesAndNumbersFromEvidence({ nudge: true })
      .build();
    await agent.run({ message: 'stage the rows' });
    const r: Run = { snapshot: agent.getSnapshot()!, wire };

    // Turn 2 is where the ticket exists and the spender is served.
    const second = servedAt(r.snapshot, 2)!;
    expect(second.messages.requestOnly).toHaveLength(1);
    expect(second.messages.requestOnly[0]!.reason).toBe('staged-refs-nudge');
    expect(second.messages.requestOnly[0]!.text).toContain('`compute`');
    // It is request-only: the rebuilt conversation does not contain it.
    expect(JSON.stringify(second.messages.asSent)).not.toContain('[staged data');
    // …and turn 1 had nothing staged yet.
    expect(servedAt(r.snapshot, 1)!.messages.requestOnly).toEqual([]);
    clean(r);
  });
});

describe('an LLMCall chart', () => {
  it('rebuilds the conversation from messagesInjections, never as an empty one', async () => {
    // `LLMCall` has no `history`: the messages slot IS the conversation, and it
    // is committed as `messagesInjections`. A rebuild that read only `history`
    // found nothing, swallowed it with `?? []`, and ASSERTED that the provider
    // was sent no turns at all — on a source `servedAt`'s own JSDoc names.
    const { provider, wire } = scripted([answer('done')]);
    const call = LLMCall.create({ provider: provider as never, model: 'mock' })
      .system('you are a probe')
      .build();
    await call.run({ message: 'the one turn that went out' });

    const view = servedAt(call.getSnapshot()!, 1)!;
    expect(view.messages.asSent).toHaveLength(wire[0]!.messages.length);
    expect(view.messages.asSent).toHaveLength(1);
    expect(view.messages.asSent[0]!.content).toBe('the one turn that went out');
    expect(view.messages.asSent).toEqual(wire[0]!.messages);
    // It rebuilt a real conversation, so it must NOT be claiming a hole.
    expect(view.gaps.map((g) => g.gap)).not.toContain('no-conversation-on-record');
  });

  it('mints a receipt salted with its own run id, and the log rebuilds it', async () => {
    // 9.91.0. `LLMCall` owns its executor and mints a run id per run exactly
    // as `Agent` does, so the salt was always there for the taking — and a
    // shipped sentence said otherwise until 9.88.0 measured it. It takes it
    // now, and the same law the agent charts pass runs on it unchanged.
    const { provider, wire } = scripted([answer('done')]);
    const call = LLMCall.create({ provider: provider as never, model: 'mock' })
      .system('you are a probe')
      .build();
    await call.run({ message: 'the one turn that went out' });
    const snapshot = call.getSnapshot()! as unknown as Snapshot;

    const receipt = receiptAt(snapshot, 1)!;
    expect(receipt.basis.runId.length).toBeGreaterThan(0);
    expect(receipt.basis.model).toBe('mock');
    expect(failuresAt(snapshot, 1, wire[0])).toEqual([]);
    expect(servedAt(snapshot, 1)!.gaps.map((g) => g.gap)).not.toContain('no-receipt-on-chart');
  });

  it('salts each run with ITS OWN id: the same prompt fingerprints differently', async () => {
    // The chart is built once and run many times, so a mint that closed over
    // the run id at build time would salt every later run with the first
    // run's value — the exact failure the salt exists to prevent.
    const { provider } = scripted([answer('done'), answer('done')]);
    const call = LLMCall.create({ provider: provider as never, model: 'mock' })
      .system('you are a probe')
      .build();
    await call.run({ message: 'same words both times' });
    const first = receiptAt(call.getSnapshot()! as unknown as Snapshot, 1)!;
    await call.run({ message: 'same words both times' });
    const second = receiptAt(call.getSnapshot()! as unknown as Snapshot, 1)!;

    expect(second.basis.runId).not.toBe(first.basis.runId);
    expect(second.system.hash).not.toBe(first.system.hash);
    expect(second.messages.entries[0]!.hash).not.toBe(first.messages.entries[0]!.hash);
    // The same words, though — the CONTENT did not move, only the salt.
    expect(second.system.chars).toBe(first.system.chars);
  });

  it('recordReceipt: false declines the mint, and the view declares the absence', async () => {
    const { provider } = scripted([answer('done')]);
    const call = LLMCall.create({
      provider: provider as never,
      model: 'mock',
      recordReceipt: false,
    })
      .system('you are a probe')
      .build();
    await call.run({ message: 'hello' });
    const snapshot = call.getSnapshot()! as unknown as Snapshot;

    expect(receiptAt(snapshot, 1)).toBeUndefined();
    const view = servedAt(snapshot, 1)!;
    expect(view.gaps.find((g) => g.gap === 'no-receipt-on-chart')?.cause).toBe(
      'no-receipt-committed',
    );
    // Declining the witness never costs the rebuild.
    expect(view.system.text).toBe('you are a probe');
    expect(view.messages.asSent).toHaveLength(1);
  });

  it('a chart that commits NEITHER source declares the hole instead of an empty list', async () => {
    const { provider, wire } = scripted([answer('done')]);
    const call = LLMCall.create({ provider: provider as never, model: 'mock' })
      .system('you are a probe')
      .build();
    await call.run({ message: 'hello' });
    void wire;

    // Strip the one committed source this chart has — the shape of a chart
    // that never wrote one, and of a recording that lost it. Every log in the
    // recording, because `LLMCall` mounts its turn in `sf-llm-call` and the
    // slot records land in that subflow's own history.
    const stripped = stripKey(call.getSnapshot()!, 'messagesInjections');

    const view = servedAt(stripped, 1)!;
    // A view, not `undefined` — the system prompt is still provable…
    expect(view.system.text).toBe('you are a probe');
    // …and the conversation is declared UNKNOWN rather than reported empty.
    expect(view.messages.asSent).toEqual([]);
    expect(view.gaps.map((g) => g.gap)).toContain('no-conversation-on-record');
    expect(SERVED_GAPS['no-conversation-on-record'].why).toMatch(/unknown, not empty/i);
  });
});

// ─── (c) INTEGRATION — every chart shape that serves a model mints ────
//
// 9.91.0. Until this release exactly ONE stage minted a receipt — the agent's
// `call-llm` — and the other three charts that hand a model a request left
// `no-receipt-on-chart` on every view they produced. The law below is the same
// `failuresAt` the agent runs through, driven on each of them, because a
// receipt that only the chart it was written for can satisfy is not a law.

/** The chart builders are handed to an executor the CALLER owns — the shape a
 *  consumer runs them in, and the reason their salt is a dep. */
async function chartRun(chart: FlowChart, message: string): Promise<Snapshot> {
  const executor = new FlowChartExecutor(chart);
  await executor.run({ input: { message } });
  return executor.getSnapshot() as unknown as Snapshot;
}

const WEATHER: LLMToolSchema = {
  name: 'weather',
  description: 'Get weather for a city',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
};

describe('a message-API chart', () => {
  it('mints a receipt when it is handed a run id, and the log rebuilds it', async () => {
    const { provider, wire } = scripted([answer('done')]);
    const runId = 'run-message-api-7';
    const snapshot = await chartRun(
      buildMessageApiChart({
        provider: provider as never,
        model: 'mock',
        systemPrompt: 'you are a tutor',
        getRunId: () => runId,
      }),
      'the one turn that went out',
    );

    expect(receiptAt(snapshot, 1)!.basis.runId).toBe(runId);
    expect(receiptAt(snapshot, 1)!.basis.provider).toBe('conformance-mock');
    // The whole law, on a chart that had none of it until 9.91.0.
    expect(failuresAt(snapshot, 1, wire[0])).toEqual([]);
    // …and the view stops declaring an absence that is no longer there.
    expect(servedAt(snapshot, 1)!.gaps.map((g) => g.gap)).not.toContain('no-receipt-on-chart');
  });

  it('mints NONE without one, rather than salting every hash with nothing', async () => {
    // THE RULE, driven: a receipt's hashes are salted with the run id so a
    // short prompt cannot be fingerprinted across runs. A builder run on
    // somebody else's executor cannot invent that value, so it declines the
    // mint — and the rebuild it never needed is untouched.
    const { provider } = scripted([answer('done')]);
    const snapshot = await chartRun(
      buildMessageApiChart({
        provider: provider as never,
        model: 'mock',
        systemPrompt: 'you are a tutor',
      }),
      'hello',
    );

    expect(receiptAt(snapshot, 1)).toBeUndefined();
    const view = servedAt(snapshot, 1)!;
    expect(view.gaps.find((g) => g.gap === 'no-receipt-on-chart')?.cause).toBe(
      'no-receipt-committed',
    );
    expect(view.system.text).toBe('you are a tutor');
    expect(view.messages.asSent).toHaveLength(1);
  });
});

describe('an agent message-API chart', () => {
  it('every turn of the loop mints, and every epoch is located and conforms', async () => {
    const { provider, wire } = scripted([call('c1', 'weather'), answer('sunny')]);
    const runId = 'run-agent-message-api-2';
    const snapshot = await chartRun(
      buildAgentMessageApiChart({
        provider: provider as never,
        model: 'mock',
        systemPrompt: 'you are a tutor',
        tools: [WEATHER],
        getRunId: () => runId,
      }),
      'weather in paris?',
    );

    // `epochLocations` finds the loop's turns by the run's OWN numbers.
    const located = epochLocations(snapshot);
    expect(located.map((l) => l.epoch)).toEqual([1, 2]);
    for (const [i, location] of located.entries()) {
      expect(failuresAt(snapshot, location.epoch, wire[i])).toEqual([]);
    }
  });

  it('the tool the model was served is hashed by the receipt AND rebuilt from the log', async () => {
    // RED BEFORE 9.91.0, for the rebuild half: the agent charts commit the
    // served list as `dynamicToolSchemas` and this chart carries the tools
    // slot's output out under its own name, so `servedAt` read no array and
    // reported `tools.names: []` on a call that served one. An empty list is
    // not an omission, it is a DENIAL — and it went unnoticed while no receipt
    // existed to contradict it.
    const { provider } = scripted([answer('sunny')]);
    const runId = 'run-agent-message-api-3';
    const snapshot = await chartRun(
      buildAgentMessageApiChart({
        provider: provider as never,
        model: 'mock',
        systemPrompt: 'you are a tutor',
        tools: [WEATHER],
        getRunId: () => runId,
      }),
      'weather in paris?',
    );

    const receipt = receiptAt(snapshot, 1)!;
    const view = servedAt(snapshot, 1)!;
    expect(receipt.tools.names).toEqual(['weather']);
    expect(view.tools.names).toEqual(['weather']);
    // The third digest half of the law, verified from outside exactly as the
    // `toolDigestInput` docstring promises a consumer can.
    for (const schema of view.tools.schemas) {
      expect(receipt.tools.schemaHashes[schema.name]).toBe(
        receiptHash(receipt.basis.runId, toolDigestInput(schema)),
      );
    }
  });

  it('mints none without a run id, and the rebuilt tool list still stands', async () => {
    const { provider } = scripted([answer('sunny')]);
    const snapshot = await chartRun(
      buildAgentMessageApiChart({
        provider: provider as never,
        model: 'mock',
        systemPrompt: 'you are a tutor',
        tools: [WEATHER],
      }),
      'weather in paris?',
    );

    const view = servedAt(snapshot, 1)!;
    expect(receiptAt(snapshot, 1)).toBeUndefined();
    expect(view.gaps.find((g) => g.gap === 'no-receipt-on-chart')?.cause).toBe(
      'no-receipt-committed',
    );
    // A missing receipt costs the WITNESS, never the rebuild.
    expect(view.tools.names).toEqual(['weather']);
  });
});

describe('a cache strategy that rewrites the request', () => {
  it('the rewrite is recorded as a transform hash and named as a gap', async () => {
    const { provider, wire } = scripted([answer('done')]);
    const rewriting = {
      name: 'rewriting-test-strategy',
      prepareRequest: async (req: LLMRequest) => ({
        request: { ...req, systemPrompt: `${req.systemPrompt ?? ''}\n\n<<cached>>` },
        markersApplied: [],
      }),
      readCacheMetrics: () => ({ kind: 'notApplicable' as const, reason: 'test strategy' }),
    };
    const agent = Agent.create({
      provider: provider as never,
      model: 'mock',
      cacheStrategy: rewriting as never,
    })
      .system('bot')
      .build();
    await agent.run({ message: 'go' });
    const r: Run = { snapshot: agent.getSnapshot()!, wire };

    const receipt = receiptAt(r.snapshot, 1)!;
    // The rewrite happened and is fingerprinted…
    expect(receipt.cache.transformHash).not.toBeNull();
    expect(wire[0]!.systemPrompt).toContain('<<cached>>');
    // …and the receipt's system hash is the string BEFORE the rewrite: it
    // records the composition, and the strategy's edit is the declared gap.
    expect(receiptHash(receipt.basis.runId, wire[0]!.systemPrompt ?? '')).not.toBe(
      receipt.system.hash,
    );
    expect(servedAt(r.snapshot, 1)!.gaps.map((g) => g.gap)).toContain('cache-transform');
    // …and the verdict is three-valued, so a reader branches on the word.
    expect(receipt.cache.transform).toBe('rewritten');
    // The gap names everything a rewrite could have reached, not only the three
    // fields that DESCRIBE the rewrite — the system text it really did change
    // among them.
    const cacheGap = servedAt(r.snapshot, 1)!.gaps.find((g) => g.gap === 'cache-transform')!;
    expect(cacheGap.fields).toEqual(
      expect.arrayContaining([
        'cache.transform',
        'system.hash',
        'system.pieces',
        'messages.entries',
        'tools.names',
        'tools.schemaHashes',
      ]),
    );
    // Everything except the wire witness still conforms.
    clean(r, { wire: false });
  });

  it('a rewritten sampling dial is recorded as the value the PORT got', async () => {
    // A strategy holds the WHOLE composed request, so it can move a dial as
    // easily as a marker. `params` used to be read off `baseRequest` — the
    // request handed TO the strategy — so five receipt fields described a
    // request the port was never handed, no gap named them, and
    // SERVED_GAPS['provider-defaults'] asserted the opposite in words.
    const { provider, wire } = scripted([answer('done')]);
    const retuning = {
      name: 'retuning-test-strategy',
      prepareRequest: async (req: LLMRequest) => ({
        request: { ...req, maxTokens: 4096, temperature: 0.9 },
        markersApplied: [],
      }),
      readCacheMetrics: () => ({ kind: 'notApplicable' as const, reason: 'test strategy' }),
    };
    const agent = Agent.create({
      provider: provider as never,
      model: 'mock',
      maxTokens: 256,
      temperature: 0.1,
      cacheStrategy: retuning as never,
    })
      .system('bot')
      .build();
    await agent.run({ message: 'go' });
    const r: Run = { snapshot: agent.getSnapshot()!, wire };

    // The strategy really moved both dials…
    expect(wire[0]!.maxTokens).toBe(4096);
    expect(wire[0]!.temperature).toBe(0.9);
    // …and the receipt records what the PORT was handed, which is what
    // ReceiptParams and RECEIPT_BOUNDARY both promise it records.
    const receipt = receiptAt(r.snapshot, 1)!;
    expect(receipt.params.maxTokens).toBe(4096);
    expect(receipt.params.temperature).toBe(0.9);
    // So `params` is NOT among the fields the cache gap excuses: it is the one
    // part of a receipt read past the strategy, and a gap that named it would
    // be excusing a field that needs no excuse.
    const view = servedAt(r.snapshot, 1)!;
    expect(view.gaps.find((g) => g.gap === 'cache-transform')!.fields).not.toContain('params');
    // The composition is untouched here, so the WIRE witness stays on — and it
    // is the dial clauses of the law that go red without the fix.
    clean(r);
  });
});

// ─── (d) EDGE — redaction, JSON round-trip, an old recording ──────────

// This block used to be a fiction. It passed `redact: [...]` to
// `Agent.create`, which has no such option; `tsconfig.json` excludes `test/`,
// so the unknown key was never typechecked and was silently dropped. The run
// was NOT redacted, the assertion it made was about a run that does not exist,
// and two READMEs documented the behaviour it pretended to prove. What follows
// is what is actually true, asserted so that nobody can write the fiction back.
describe('what a recording actually contains', () => {
  it('an AGENT run is not redacted — the recording carries the plaintext, verbatim', async () => {
    const { provider, wire } = scripted([answer('done')]);
    const agent = Agent.create({ provider: provider as never, model: 'mock' })
      .system('bot with key sk-abc123')
      .build();
    await agent.run({ message: 'go' });
    const r: Run = { snapshot: agent.getSnapshot()!, wire };

    // There is no agent-level redaction door, so the committed pieces are the
    // pieces. A reader handed this recording can read the key.
    expect(servedAt(r.snapshot, 1)!.system.text).toContain('sk-abc123');
    expect(JSON.stringify(r.snapshot.commitLog)).toContain('sk-abc123');
    // The law holds all the way to the wire, because nothing diverged.
    clean(r);
  });

  it('the RECEIPT carries hashes of that plaintext, and the hashes are not scrubbed', async () => {
    const { provider, wire } = scripted([answer('done')]);
    const agent = Agent.create({ provider: provider as never, model: 'mock' })
      .system('bot with key sk-abc123')
      .build();
    await agent.run({ message: 'go' });
    void wire;
    const receipt = receiptAt(agent.getSnapshot()!, 1)!;

    // No bytes: the key is not on the receipt…
    expect(JSON.stringify(receipt)).not.toContain('sk-abc123');
    // …but its hash is, unredacted, and the SALT is the whole reason that is
    // safe to ship. The same sentence under another run id is another hash, so
    // the digest cannot be dictionary-matched across recordings.
    expect(receipt.system.hash).toBe(receiptHash(receipt.basis.runId, 'bot with key sk-abc123'));
    expect(receiptHash('some-other-run', 'bot with key sk-abc123')).not.toBe(receipt.system.hash);
  });

  it('redaction is EXECUTOR-level and reaches an inner tool run, not an agent log', async () => {
    // The door that does exist: `flowchartAsTool({ redact })` →
    // `executor.setRedactionPolicy`. footprintjs scrubs at COMMIT time, so the
    // inner record never holds the value at all.
    const chart = flowChart<{ apiKey: string; used: string }>(
      'Use the key',
      (scope) => {
        scope.apiKey = 'sk-inner-secret';
        scope.used = 'called';
      },
      'use-key',
    ).build();
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'runs a chart that touches a key',
      flowchart: chart,
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    await tool.execute({}, { toolCallId: 'c1' } as never);
    const record = innerRunsOf(tool)!.get('c1')!;
    const snapshot = record.recording?.snapshot as {
      commitLog: unknown[];
      sharedState: Record<string, unknown>;
    };
    // The COMMIT LOG — what every fold in this folder reads — is scrubbed at
    // write time, so the value never entered it.
    expect(JSON.stringify(snapshot.commitLog)).not.toContain('sk-inner-secret');
    expect(JSON.stringify(snapshot.commitLog)).toContain('REDACTED');
    // `sharedState` is served from the redacted MIRROR since 9.89.1
    // (`servableSnapshot`): until then the kept record held the plaintext here
    // while its log said REDACTED — recorded-not-built entry 6, now built. The
    // whole record is asserted as bytes in `test/core/flowchartAsTool.redact.test.ts`.
    expect(snapshot.sharedState.apiKey).toBe('REDACTED');
    expect(JSON.stringify(snapshot)).not.toContain('sk-inner-secret');
  });
});

describe('a recording that travelled without its fold base', () => {
  it('declares a gap instead of rebuilding an empty view', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    // Exactly the shape `getSnapshot({ redact: true })` hands back: the log
    // travels, the fold base does not.
    const baseless = JSON.parse(JSON.stringify(r.snapshot)) as Snapshot & {
      initialState?: unknown;
    };
    expect(baseless.initialState).toBeDefined();
    delete baseless.initialState;

    const view = servedAt(baseless, 1)!;
    expect(view.gaps.map((g) => g.gap)).toContain('no-fold-base');
    // The SENTENCE says what the fields mean, not what went missing: it named
    // `initialState` until 9.88.0's sixth round, which is a key in a constant a
    // renderer prints to somebody who cannot check it. The mechanism moved to
    // the comment beside the entry; what a reader is told is that these fields
    // may be SHORT.
    expect(SERVED_GAPS['no-fold-base'].why).toMatch(/may be SHORT/);
    expect(SERVED_GAPS['no-fold-base'].why).not.toMatch(/initialState/);
    // …and the gap EXCUSES the fields it names, rather than the law quietly
    // passing a short rebuild.
    expect(SERVED_GAPS['no-fold-base'].fields).toContain('messages.entries');
  });

  it('declares it for the RUN base too, which a grouped recording loses on its own', async () => {
    // THE SHAPE THAT DENIED. Under 'dynamic-grouped' there are TWO folds per
    // epoch: the turn's own inner subtree (which carries its own initialState,
    // inside subflowResults) and the RUN log, where every build-time constant
    // lives — the forced output tool's name, the `wants` the staged-refs nudge
    // is composed from. Strip only the top-level initialState and the inner
    // fold is still perfect while the run fold is baseless, so a gap raised off
    // `location.basis` alone read every run constant as absent and declared
    // NOTHING. A Lens may omit; it may not deny.
    const r = await run('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    const baseless = JSON.parse(JSON.stringify(r.snapshot)) as Snapshot & {
      initialState?: unknown;
    };
    delete baseless.initialState;

    // The two bases really do disagree — this is what makes the case
    // discriminating rather than a second copy of the test above.
    const located = epochLocations(baseless);
    expect(located[0]!.basis).toBe('initial+log');
    expect(located[0]!.runBasis).toBe('log-only');

    expect(servedAt(baseless, 1)!.gaps.map((g) => g.gap)).toContain('no-fold-base');
    // …and the gap names what a missing RUN base actually costs: the run
    // constants, and everything composed from them.
    expect(SERVED_GAPS['no-fold-base'].fields).toEqual(
      expect.arrayContaining(['tools.forced', 'tools.names', 'messages.requestOnly']),
    );
    // The intact recording says nothing of the sort.
    expect(servedAt(r.snapshot, 1)!.gaps.map((g) => g.gap)).not.toContain('no-fold-base');
  });
});

describe('the epoch NUMBER on a recording with no base', () => {
  it('is the position the fold fell back to, and the receipt still says the truth', async () => {
    // THE INVERSION 9.88.0's fourth review round found. TWO epoch numbers exist
    // and they are two RECORDS of the same fact, not two spellings of it:
    //
    //   • `ServedView.epoch` is what the FOLD produced. `EpochLocation.epoch`
    //     reads the run's committed `iteration` and, when it cannot, numbers
    //     the turn by its POSITION instead — so a base-less recording can
    //     fabricate it. `no-fold-base` names it.
    //   • `Receipt.basis.epoch` was minted LIVE, from the counter the call
    //     itself read, and rides in that call's own bundle. No missing base
    //     touches it; only a missing receipt loses it, which is why
    //     `no-receipt-on-chart` names that one.
    //
    // The catalogue had these the wrong way round: `no-fold-base` named the
    // receipt's number (which its mechanism cannot move) while the view's own
    // was excused in UNGAPPED_FIELDS as "the number you asked for" — true of
    // `servedAt(k)`, untrue of `servedViews()`, which returns the fold's.
    const { provider } = scripted([call('c1', 'ask_human'), answer('done')]);
    const agent = Agent.create({ provider: provider as never, model: 'mock' })
      .system('SYSTEM_MARKER you are a bot')
      .tool({
        schema: { name: 'ask_human', description: 'ask', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'proceed?' });
          return '';
        },
      })
      .build();
    const paused = await agent.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;
    await agent.resume(paused.checkpoint, 'yes');
    const snapshot = agent.getSnapshot()!;

    // INTACT: the one epoch on the resumed snapshot is the run's second turn,
    // and both records agree about that.
    const intact = servedViews(snapshot);
    expect(intact).toHaveLength(1);
    expect(intact[0]!.epoch).toBe(2);
    expect(receiptAt(snapshot, 2)!.basis.epoch).toBe(2);

    // DAMAGED: the base is gone and so are the `iteration` writes, which is
    // what a resumed run looks like when its checkpoint state did not travel.
    const baseless = stripKey(
      JSON.parse(JSON.stringify(snapshot)) as Snapshot & { initialState?: unknown },
      'iteration',
    );
    delete baseless.initialState;

    const rebuilt = servedViews(baseless);
    expect(rebuilt).toHaveLength(1);
    // The view now calls the second turn the FIRST — a number the fold made up
    // from position, exactly as `EpochLocation.epoch` says it will.
    expect(rebuilt[0]!.epoch).toBe(1);
    // …while the receipt that turn minted still says 2. Two records, disagreeing.
    expect(receiptAt(baseless, 1)!.basis.epoch).toBe(2);

    // And the disagreement is DECLARED rather than left to be noticed: the gap
    // fires, and it names the number that moved — not the one that did not.
    expect(rebuilt[0]!.gaps.map((g) => g.gap)).toContain('no-fold-base');
    expect(SERVED_GAPS['no-fold-base'].fields).toContain('epoch');
    expect(SERVED_GAPS['no-fold-base'].fields).not.toContain('basis.epoch');
    expect(SERVED_GAPS['no-receipt-on-chart'].fields).toContain('basis.epoch');
    expect(UNGAPPED_FIELDS['epoch']).toBeUndefined();
  });
});

describe('a SUBTREE handed in on its own', () => {
  it('declares that every run constant is unreadable rather than reading absent', async () => {
    const r = await run('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    // A grouped recording with its run log removed: the turns are still
    // locatable (they live in subflowResults) but seed's constants are not.
    const subtree = JSON.parse(JSON.stringify(r.snapshot)) as Snapshot;
    (subtree as { commitLog: unknown[] }).commitLog = [];
    const view = servedAt(subtree, 1)!;
    expect(view.gaps.map((g) => g.gap)).toContain('no-run-log');
    // The full recording says nothing of the sort.
    expect(servedAt(r.snapshot, 1)!.gaps.map((g) => g.gap)).not.toContain('no-run-log');
  });
});

/**
 * A FOLD RESULT IS DETACHED, OR IT IS NOT A FOLD.
 *
 * `keyedFold` memoizes: the same object comes back for the same question, and
 * the forward cursor seeds every LATER epoch's replay from that very object.
 * `servedAt` then aliased those objects straight into `ServedView`, so a
 * consumer that edited what it was handed rewrote what later epochs reported
 * was served — silently, and only for readers who came after them.
 *
 * The order below is the whole test. Both copies are detached recordings so
 * the memo starts empty on each; the truth is taken from one, epoch 1 alone is
 * read on the other, the tampering happens BEFORE epoch 2 is ever asked for,
 * and only then is epoch 2 asked.
 */
describe('what a reader is handed', () => {
  /** Attempt a mutation a detached answer must refuse. A frozen target throws
   *  in module (strict) code; the throw is swallowed because the claim under
   *  test is what the NEXT read says, not how the write failed. */
  const tamper = (mutate: () => void): void => {
    try {
      mutate();
    } catch {
      /* frozen — which is the fix doing its job */
    }
  };

  it('cannot rewrite what a LATER epoch reports was served', async () => {
    const r = await run(
      'dynamic',
      [call('c1', 'alpha_tool'), call('c2', 'alpha_tool'), answer('done')],
      (a) => a.system('you are a bot').tool(tool('alpha_tool')),
      { maxIterations: 8 },
    );
    const detached = (): Snapshot => JSON.parse(JSON.stringify(r.snapshot)) as Snapshot;

    const pristine = detached();
    const truth1 = servedAt(pristine, 1)!.messages.asSent.map((m) => m.content);
    const truth2 = servedAt(pristine, 2)!.messages.asSent.map((m) => m.content);
    // Epoch 2 really does fold THROUGH epoch 1's answer, or nothing below can
    // travel from one to the other.
    expect(truth2.length).toBeGreaterThan(truth1.length);

    const target = detached();
    const view = servedAt(target, 1)!;
    expect(view.tools.schemas.length).toBeGreaterThan(0);
    // (a) the ELEMENTS — the fold's own message objects, which the cursor
    //     holds and every later epoch is replayed from.
    tamper(() => {
      (view.messages.asSent[0] as { content: string }).content = 'TAMPERED';
    });
    // (b) the CONTAINER — the array the view handed out.
    tamper(() => {
      (view.messages.asSent as LLMMessage[]).push({ role: 'user', content: 'TAMPERED' });
    });
    // (c) the tool schemas, aliased out of the same fold.
    tamper(() => {
      (view.tools.schemas[0] as { name: string }).name = 'TAMPERED';
    });
    tamper(() => {
      (view.tools.schemas as LLMToolSchema[]).length = 0;
    });

    // THE DISCRIMINATING CLAUSE: epoch 2 has not been asked yet, so without the
    // fix it is replayed from the tampered array and inherits every edit.
    expect(servedAt(target, 2)!.messages.asSent.map((m) => m.content)).toEqual(truth2);
    // …and epoch 1's own memo is not rewritten either.
    expect(servedAt(target, 1)!.messages.asSent.map((m) => m.content)).toEqual(truth1);
    expect(servedAt(target, 1)!.tools.names).toEqual(servedAt(pristine, 1)!.tools.names);
    clean(r);
  });

  it('cannot rewrite a receipt, or the epochs the next reader locates', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    const detached = (): Snapshot => JSON.parse(JSON.stringify(r.snapshot)) as Snapshot;

    // A receipt is a value folded out of the log like any other, and
    // `receiptAt` hands back the fold's own object.
    const truthHash = receiptAt(detached(), 1)!.system.hash;
    const target = detached();
    tamper(() => {
      (receiptAt(target, 1)!.system as { hash: string }).hash = 'TAMPERED';
    });
    expect(receiptAt(target, 1)!.system.hash).toBe(truthHash);

    // The epoch index is memoized on the recording, so the array and each
    // location on it are the NEXT reader's answer too.
    const truthEpochs = epochLocations(detached()).map((e) => e.epoch);
    const located = epochLocations(target);
    tamper(() => {
      (located as unknown as unknown[]).push(located[0]);
    });
    tamper(() => {
      (located[0] as unknown as { epoch: number }).epoch = 99;
    });
    expect(epochLocations(target).map((e) => e.epoch)).toEqual(truthEpochs);
  });
});

describe('a recording that travelled', () => {
  it('survives a JSON round-trip: same receipts, same views, same law', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    const travelled = JSON.parse(JSON.stringify(r.snapshot)) as Snapshot;
    expect(receiptAt(travelled, 1)).toEqual(receiptAt(r.snapshot, 1));
    expect(servedAt(travelled, 1)).toEqual(servedAt(r.snapshot, 1));
    expect(failuresAt(travelled, 1, r.wire[0])).toEqual([]);
  });
});

describe('a recording made before the receipt existed', () => {
  it('receiptAt says undefined and servedAt still rebuilds the view', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    const older = JSON.parse(JSON.stringify(r.snapshot)) as Snapshot;
    // Strip every trace of the receipt — a pre-9.88 log, exactly.
    for (const bundle of older.commitLog as Array<Record<string, never>>) {
      const b = bundle as unknown as {
        trace: { path: string }[];
        overwrite: Record<string, unknown>;
      };
      b.trace = b.trace.filter((t) => t.path !== 'receipt');
      delete b.overwrite.receipt;
    }
    expect(receiptAt(older, 1)).toBeUndefined();
    const view = servedAt(older, 1);
    expect(view).toBeDefined();
    expect(view!.system.text).toBe(servedAt(r.snapshot, 1)!.system.text);
  });
});

// ─── (e) THE MUTATION TEST — the law has to be able to go red ─────────

describe('dropping one committed piece', () => {
  it('turns the law red, naming the epoch and the field it broke', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    expect(failures(r)).toEqual([]);

    // Remove ONE system-prompt piece from the record of turn 2 — the exact
    // shape of "something reached the model that the run never wrote down".
    const damaged = JSON.parse(JSON.stringify(r.snapshot)) as Snapshot;
    let cut = 0;
    for (const bundle of damaged.commitLog as unknown as Array<{
      overwrite: Record<string, unknown>;
    }>) {
      const pieces = bundle.overwrite.systemPromptInjections;
      if (Array.isArray(pieces) && pieces.length > 0) {
        bundle.overwrite.systemPromptInjections = pieces.slice(0, -1);
        cut += 1;
      }
    }
    expect(cut).toBeGreaterThan(0);

    const broken = failuresAt(damaged, 1, r.wire[0]);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((f) => f.epoch === 1)).toBe(true);
    expect(broken.map((f) => f.field)).toContain('system.hash');
  });

  it('a message the run never committed is caught at the wire, not excused', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    const damaged = JSON.parse(JSON.stringify(r.snapshot)) as Snapshot;
    for (const bundle of damaged.commitLog as unknown as Array<{
      overwrite: Record<string, unknown>;
    }>) {
      const history = bundle.overwrite.history;
      if (Array.isArray(history) && history.length > 1) {
        bundle.overwrite.history = history.slice(0, -1);
      }
    }
    const broken = failuresAt(damaged, 2, r.wire[1]);
    expect(broken.map((f) => f.field)).toContain('messages.entries');
  });
});

// ─── (f) REGRESSION — the receipt keeps its own laws ──────────────────

describe("the receipt's own laws", () => {
  it('carries no bytes: no message text, no prompt text, no schema bodies', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('SECRET_SYSTEM_TEXT').tool(tool('alpha_tool')),
    );
    const serialized = JSON.stringify(receiptAt(r.snapshot, 1));
    expect(serialized).not.toContain('SECRET_SYSTEM_TEXT');
    expect(serialized).not.toContain('go'); // the user's message
    expect(serialized).not.toContain('the alpha_tool tool'); // the schema body
    // Names it DOES carry, because a name is what a reader needs to ask again.
    expect(serialized).toContain('alpha_tool');
  });

  it("is not part of the step's OUTPUT text — a fingerprint is not something the step said", async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('you are a bot').tool(tool('alpha_tool')),
    );
    const lastIdxOf = new Map<string, number>();
    const log = r.snapshot.commitLog as unknown as Array<{ runtimeStageId: string }>;
    log.forEach((b, i) => lastIdxOf.set(b.runtimeStageId, i));
    const callId = servedAt(r.snapshot, 1)!.callRuntimeStageId;
    const text = stepOutputText(r.snapshot.commitLog as never, lastIdxOf, callId, 4000)!;
    // The step really did commit one…
    expect(receiptAt(r.snapshot, 1)).toBeDefined();
    // …and the text an embedder is handed does not carry it. Run-salted hex is
    // semantically empty by construction; inside a character budget it is noise
    // that crowds out the assistant's own words.
    expect(text).not.toContain('receipt=');
    expect(text).toContain('llmLatestToolCalls=');
  });

  it('names no authority omission, even when the run has one', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) => a.system('bot').skillGraph(graphOf()));
    for (const view of servedViews(r.snapshot)) {
      const receipt = receiptAt(r.snapshot, view.epoch)! as Receipt & Record<string, unknown>;
      expect(Object.keys(receipt)).not.toContain('hiddenSkillIds');
      expect(JSON.stringify(receipt)).not.toContain('hidden');
    }
  });
});

// ─── (g) THE DIGEST — what a message's fingerprint has to cover ───────

describe('the message digest', () => {
  it('separates two parallel tool results by their JOIN KEY, not just their text', () => {
    // The failure this closes: two tool calls issued in one turn, whose
    // results happen to be byte-identical ("ok", "[]", "3600"). Without
    // `toolCallId` on the digest they hash the SAME, so filing c1's answer
    // under c2 — a real and silent agent bug — was invisible to the law.
    const a: LLMMessage = { role: 'tool', content: 'ok', toolCallId: 'c1', toolName: 'lookup' };
    const b: LLMMessage = { role: 'tool', content: 'ok', toolCallId: 'c2', toolName: 'lookup' };
    expect(messageDigestInput(a)).not.toBe(messageDigestInput(b));
    expect(messageDigestInput(a)).toContain('c1');
    // …and the same result under the same id is still the same thing said.
    expect(messageDigestInput(a)).toBe(messageDigestInput({ ...a }));
  });

  it('separates them by NAME too — two shipped providers join on the name, not the id', () => {
    // `adapters/llm/GeminiProvider.ts` · `toGeminiContents` pairs a
    // functionResponse to its call BY NAME and drops a non-real id;
    // `adapters/llm/OllamaProvider.ts` · `toOllamaMessages` puts `tool_name` on
    // the wire. On those two, swapping the names IS the mis-pairing, and a
    // digest covering only `toolCallId` could not see it.
    const a: LLMMessage = { role: 'tool', content: 'ok', toolCallId: 'c1', toolName: 'lookup' };
    const b: LLMMessage = { role: 'tool', content: 'ok', toolCallId: 'c1', toolName: 'refund' };
    expect(messageDigestInput(a)).not.toBe(messageDigestInput(b));
    // The whole swap, both messages, exactly as a Gemini/Ollama history would
    // carry it: identical text and ids, names exchanged.
    const swapped = (name: string): LLMMessage => ({ role: 'tool', content: 'ok', toolName: name });
    expect(messageDigestInput(swapped('lookup'))).not.toBe(messageDigestInput(swapped('refund')));
    // A name is a FIELD of its own, so it cannot absorb the id's bytes or be
    // absorbed by them: id 'c1'+name 'x' is not id 'c1x'+no name.
    expect(
      messageDigestInput({ role: 'tool', content: 'ok', toolCallId: 'c1', toolName: 'x' }),
    ).not.toBe(messageDigestInput({ role: 'tool', content: 'ok', toolCallId: 'c1x' }));
    // A message with no name at all is unchanged by the new field.
    expect(messageDigestInput({ role: 'user', content: 'hi' })).toBe(
      messageDigestInput({ role: 'user', content: 'hi' }),
    );
  });

  it('covers thinking blocks — which MUST be echoed byte-exact or the API rejects', () => {
    const bare: LLMMessage = { role: 'assistant', content: 'thinking done' };
    const signed: LLMMessage = {
      ...bare,
      thinkingBlocks: [{ type: 'thinking', content: 'because…', signature: 'sig-A' }],
    };
    const resigned: LLMMessage = {
      ...bare,
      thinkingBlocks: [{ type: 'thinking', content: 'because…', signature: 'sig-B' }],
    };
    expect(messageDigestInput(signed)).not.toBe(messageDigestInput(bare));
    // A DIFFERENT signature is a different request: one of these is accepted
    // by the provider and one is rejected, and the digest has to tell them
    // apart. It carries the fingerprint, never the block's text as content.
    expect(messageDigestInput(signed)).not.toBe(messageDigestInput(resigned));
  });

  it("covers a tool call's providerMeta — the vendor state that round-trips", () => {
    const plain: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'lookup', args: {} }],
    };
    const withMeta: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'c1', name: 'lookup', args: {}, providerMeta: { thoughtSignature: 'abc' } },
      ],
    };
    expect(messageDigestInput(plain)).not.toBe(messageDigestInput(withMeta));
  });

  it('marks a value JSON cannot express instead of collapsing it to nothing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    // The primitive says "I could not read this" …
    expect(stableJson(cyclic)).toBeUndefined();
    // … and the digest records the mark, so two unreadable arguments are not
    // silently the same argument.
    const one: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'x', args: cyclic as never }],
    };
    expect(messageDigestInput(one)).toContain('<unserializable>');
  });
});

describe('a request the receipt cannot serialize', () => {
  it("says 'unknown' rather than claiming the cache strategy changed nothing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const other: Record<string, unknown> = { different: true };
    other.self = other;

    // Two DIFFERENT unserializable requests. `stableJson` used to return `''`
    // for both, so they compared equal and the receipt wrote
    // `transformHash: null` — "the strategy changed nothing" — about a pair it
    // had never read.
    const receipt = buildReceipt({
      runId: 'r1',
      epoch: 1,
      model: 'm',
      provider: 'p',
      systemText: 'sys',
      systemPieces: [],
      messages: [],
      requestOnly: [],
      tools: [],
      forced: null,
      withheld: null,
      baseRequest: cyclic,
      preparedRequest: other,
    });
    expect(receipt.cache.transform).toBe('unknown');
    expect(receipt.cache.transformHash).toBeNull();

    // And the honest reading of `null` is only available through the word:
    // an unrewritten request also reports `null`, with a different verdict.
    const unchanged = buildReceipt({
      runId: 'r1',
      epoch: 1,
      model: 'm',
      provider: 'p',
      systemText: 'sys',
      systemPieces: [],
      messages: [],
      requestOnly: [],
      tools: [],
      forced: null,
      withheld: null,
      baseRequest: { a: 1 },
      preparedRequest: { a: 1 },
    });
    expect(unchanged.cache.transform).toBe('unchanged');
    expect(unchanged.cache.transformHash).toBeNull();
  });
});

// ─── (h) THE SAMPLING KNOBS AND THE CACHE BREAKPOINTS ────────────────

describe('the sampling knobs', () => {
  it('are on the receipt — the same context at another temperature is another call', async () => {
    const { provider, wire } = scripted([answer('done')]);
    const agent = Agent.create({
      provider: provider as never,
      model: 'mock',
      temperature: 0.25,
      maxTokens: 512,
    })
      .system('bot')
      .build();
    await agent.run({ message: 'go' });
    const r: Run = { snapshot: agent.getSnapshot()!, wire };

    const receipt = receiptAt(r.snapshot, 1)!;
    expect(receipt.params.temperature).toBe(0.25);
    expect(receipt.params.maxTokens).toBe(512);
    // Value-conditional: a dial nobody set records no key, rather than a
    // default the library never sent.
    expect(receipt.params.thinkingBudget).toBeUndefined();
    expect('stop' in receipt.params).toBe(false);
    // The gap that keeps that honest, in the library's own words.
    expect(servedAt(r.snapshot, 1)!.gaps.map((g) => g.gap)).toContain('provider-defaults');
    expect(SERVED_GAPS['provider-defaults'].why).toMatch(
      /not the same as the model running without one/,
    );
    clean(r);
  });

  it('an agent with no dials set records none of them', async () => {
    const r = await run('dynamic', [answer('done')], (a) => a.system('bot'));
    expect(receiptAt(r.snapshot, 1)!.params).toEqual({});
    clean(r);
  });
});

describe('the cache breakpoints', () => {
  it('records WHICH markers were applied, so two epochs are comparable', async () => {
    // `cache.transformHash` is a digest over the whole prepared request: within
    // a run it says only "something changed", and across epochs it is not
    // comparable at all. The question that decides an Anthropic bill —
    // "did the breakpoints move between call 3 and call 4?" — needs the
    // markers themselves, and they existed only inside the calling stage.
    const applying = {
      name: 'marker-applying-test-strategy',
      prepareRequest: async (req: LLMRequest) => ({
        request: req,
        markersApplied: [
          { field: 'system' as const, boundaryIndex: 0, ttl: 'long' as const, reason: 'test' },
        ],
      }),
      readCacheMetrics: () => ({ kind: 'notApplicable' as const, reason: 'test strategy' }),
    };
    const { provider, wire } = scripted([call('c1', 'alpha_tool'), answer('done')]);
    const agent = Agent.create({
      provider: provider as never,
      model: 'mock',
      cacheStrategy: applying as never,
    })
      .system('bot')
      .tool(tool('alpha_tool'))
      .build();
    await agent.run({ message: 'go' });
    const r: Run = { snapshot: agent.getSnapshot()!, wire };

    for (const view of servedViews(r.snapshot)) {
      const receipt = receiptAt(r.snapshot, view.epoch)!;
      expect(receipt.cache.markersApplied).toEqual([
        { field: 'system', boundaryIndex: 0, ttl: 'long' },
      ]);
      // Three scalars. `reason` is a diagnostic STRING the strategy composed,
      // and a receipt carries no prose.
      expect(JSON.stringify(receipt.cache.markersApplied)).not.toContain('test');
    }
    // The strategy returned the request it was given, so the verdict is the
    // narrow one — about the CACHE STRATEGY and nothing downstream of it.
    expect(receiptAt(r.snapshot, 1)!.cache.transform).toBe('unchanged');
    clean(r);
  });

  it('a run with no cache strategy records no applied markers, not an absent field', async () => {
    const r = await run('dynamic', [answer('done')], (a) => a.system('bot'));
    expect(receiptAt(r.snapshot, 1)!.cache.markersApplied).toEqual([]);
  });
});

describe("the cache gap's own wording", () => {
  it('says only that what reached the provider may differ, and quotes no receipt', () => {
    const why = SERVED_GAPS['cache-transform'].why;
    // THREE false sentences have stood here. The first claimed a null
    // transformHash proved "this particular call was not rewritten", which the
    // receipt cannot know. The second — 9.88.0's own, false on day one —
    // claimed "only its INPUTS are on the record", while `cache.transform`,
    // `cache.transformHash` and `cache.markersApplied` are outputs and are all
    // on the receipt. Both were MECHANISM claims, and the sixth round's rule
    // deletes the category: the sentence now says what the fields MEAN.
    expect(why).not.toMatch(/this particular call was not rewritten/);
    expect(why).not.toMatch(/only its INPUTS/);
    expect(why).toContain('What reached the provider may differ from the fields below');
    // THE THIRD, killed in the seventh round: this entry APPENDED
    // `RECEIPT_BOUNDARY`, whose first words are "A receipt describes the
    // request…" — and this entry is raised on EVERY view, including the ones
    // with no receipt at all. Measured below: a message-API chart run without
    // a run id carries this gap and has no receipt behind it, so the reader
    // was told about a thing that is not there. (It was an `LLMCall` view
    // until 9.91.0, where that chart started minting.) The boundary CLAIM survives in the entry's own first
    // sentence, in the vocabulary of a view; the QUOTE moved to the one entry
    // that is only ever raised where a receipt was read.
    expect(why).not.toContain(RECEIPT_BOUNDARY);
    expect(SERVED_GAPS['provider-defaults'].why).toContain(RECEIPT_BOUNDARY);
    expect(RECEIPT_BOUNDARY).toMatch(/as this library last saw it/);
    // …and the three OUTPUT fields the deleted sentence denied are on the
    // receipt, which is why that sentence was false rather than merely loose.
    expect(SERVED_GAPS['cache-transform'].fields).toEqual(
      expect.arrayContaining(['cache.transform', 'cache.transformHash', 'cache.markersApplied']),
    );
  });

  it('and the receipt-less chart really does carry it — the run that made that wrong', async () => {
    // The measurement the assertion above rests on, taken rather than assumed.
    // The receipt-less shape a SHIPPED chart still produces (9.91.0): a chart
    // builder run on the caller's own executor with no run id to salt with.
    const { provider } = scripted([answer('done')]);
    const snapshot = await chartRun(
      buildMessageApiChart({
        provider: provider as never,
        model: 'mock',
        systemPrompt: 'you are a probe',
      }),
      'go',
    );
    const view = servedAt(snapshot, 1)!;
    expect(view.basis).toBeUndefined();
    expect(view.gaps.map((g) => g.gap)).toContain('cache-transform');
    // Nothing this view prints mentions a receipt describing anything.
    expect(view.gaps.some((g) => g.why.includes(RECEIPT_BOUNDARY))).toBe(false);
  });

  it('a provider decorated AFTER the port rewrites the request and the receipt says nothing', async () => {
    // Reproduced, not asserted from theory: the library hands `inner` the
    // request, the receipt fingerprints THAT, and the decorator adds a system
    // suffix and a ghost tool afterwards. `transform` still reads 'unchanged'
    // — correctly, because the cache strategy changed nothing — which is
    // exactly why the sentence had to stop claiming more.
    const seen: LLMRequest[] = [];
    const inner = scripted([answer('done')]);
    const decorated = {
      name: 'decorated',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        const rewritten: LLMRequest = {
          ...req,
          systemPrompt: `${req.systemPrompt ?? ''}\n\n<<injected by a decorator>>`,
          tools: [
            ...(req.tools ?? []),
            {
              name: 'ghost_tool',
              description: 'never registered',
              inputSchema: { type: 'object' },
            },
          ],
        };
        seen.push(rewritten);
        return inner.provider.complete(rewritten);
      },
    };
    const agent = Agent.create({ provider: decorated as never, model: 'mock' })
      .system('bot')
      .build();
    await agent.run({ message: 'go' });
    const snapshot = agent.getSnapshot()!;

    const receipt = receiptAt(snapshot, 1)!;
    expect(receipt.cache.transform).toBe('unchanged');
    expect(receipt.cache.transformHash).toBeNull();
    // The model really did read a prompt and a tool the record cannot show.
    expect(seen[0]!.systemPrompt).toContain('<<injected by a decorator>>');
    expect(seen[0]!.tools!.map((t) => t.name)).toContain('ghost_tool');
    expect(receipt.tools.names).not.toContain('ghost_tool');
    // Nothing here is a bug in the receipt — it is the boundary, and the
    // boundary is stated where a reader will meet it. TWO sentences say it on
    // this view, and they say it to two different readers: the cache entry in
    // the vocabulary of the view (which is why it holds on a view with no
    // receipt), and the dials entry as the boundary constant itself, which is
    // honest here because this run minted a receipt.
    const gaps = servedAt(snapshot, 1)!.gaps;
    expect(gaps.find((g) => g.gap === 'cache-transform')!.why).toContain(
      'What reached the provider may differ from the fields below',
    );
    expect(gaps.find((g) => g.gap === 'provider-defaults')!.why).toContain(RECEIPT_BOUNDARY);
  });
});

// ─── (i) THE VIEW'S OWN EDGES ────────────────────────────────────────

describe('which model saw this', () => {
  it('is on the served view, read off the receipt basis', async () => {
    const r = await run('dynamic', [answer('done')], (a) => a.system('bot'));
    const view = servedAt(r.snapshot, 1)!;
    expect(view.basis).toEqual({
      model: 'mock',
      provider: 'conformance-mock',
      runId: receiptAt(r.snapshot, 1)!.basis.runId,
    });
    // …and it is honestly absent when there is no receipt to read it from.
    const older = stripKey(r.snapshot, 'receipt');
    expect(receiptAt(older, 1)).toBeUndefined();
    expect(servedAt(older, 1)!.basis).toBeUndefined();
  });
});

describe('epoch numbering', () => {
  it('starts at 1 — epoch 0 is not a stop, and both readers say so the same way', async () => {
    const r = await run('dynamic', TOOL_THEN_DONE, (a) => a.system('bot').tool(tool('alpha_tool')));
    expect(receiptAt(r.snapshot, 0)).toBeUndefined();
    expect(servedAt(r.snapshot, 0)).toBeUndefined();
    expect(receiptAt(r.snapshot, 1)).toBeDefined();
    expect(servedAt(r.snapshot, 1)).toBeDefined();
  });
});

describe('the receipt off switch', () => {
  it('recordReceipt:false mints none, and servedAt still rebuilds every epoch', async () => {
    const { provider, wire } = scripted(TOOL_THEN_DONE);
    const agent = Agent.create({
      provider: provider as never,
      model: 'mock',
      maxIterations: 6,
      recordReceipt: false,
    })
      .system('you are a bot')
      .tool(tool('alpha_tool'))
      .build();
    await agent.run({ message: 'go' });
    const snapshot = agent.getSnapshot()!;

    const views = servedViews(snapshot);
    expect(views).toHaveLength(2);
    for (const view of views) {
      expect(receiptAt(snapshot, view.epoch)).toBeUndefined();
      // The rebuild is untouched: it never needed the receipt to work.
      expect(view.system.text).toBe(wire[view.epoch - 1]!.systemPrompt);
      expect(view.messages.asSent).toHaveLength(wire[view.epoch - 1]!.messages.length);
    }
    // No receipt anywhere in the log — the key is simply never written.
    expect(JSON.stringify(snapshot.commitLog)).not.toContain('"receipt"');
  });

  it('the default is ON — an agent that says nothing gets one', async () => {
    const r = await run('dynamic', [answer('done')], (a) => a.system('bot'));
    expect(receiptAt(r.snapshot, 1)).toBeDefined();
  });
});

// ─── (j) THE SCHEMA LAW — the third digest half, on real runs (9.89.0) ──

describe('the schema law: a consumer can verify every schemaHashes row from outside', () => {
  // 9.88.0 exported `receiptHash` and `messageDigestInput`, so the system text,
  // the pieces and the messages of a served view could be proved against the
  // receipt from outside this package. The tool schemas could not: their rows
  // were minted through a serializer the barrel did not export. This is the
  // law for that third row, on the object a consumer actually holds —
  // `servedAt(k).tools.schemas[i]` — for every tool of every epoch.
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: receiptHash(runId, toolDigestInput(tool)) === schemaHashes[tool.name], every tool, every epoch`, async () => {
      const r = await run(
        reactMode,
        [call('c1', 'alpha_tool'), call('c2', 'beta_tool'), answer('done')],
        (a) => a.system('s').tool(tool('alpha_tool')).tool(tool('beta_tool')),
      );
      const views = servedViews(r.snapshot);
      expect(views.length).toBeGreaterThan(1);
      let checked = 0;
      for (const view of views) {
        const receipt = receiptAt(r.snapshot, view.epoch)!;
        expect(receipt).toBeDefined();
        for (const served of view.tools.schemas) {
          expect(receiptHash(receipt.basis.runId, toolDigestInput(served))).toBe(
            receipt.tools.schemaHashes[served.name],
          );
          checked += 1;
        }
        // Nothing hashed that the view cannot show: with no forced tool, the
        // receipt's rows and the served schemas are the same set of names.
        expect(Object.keys(receipt.tools.schemaHashes).sort()).toEqual(
          view.tools.schemas.map((s) => s.name).sort(),
        );
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('a schema that changed between two epochs is caught: the row from epoch 1 does not verify epoch 2', async () => {
    const r = await run('dynamic', [call('c1', 'alpha_tool'), answer('done')], (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );
    const view = servedAt(r.snapshot, 1)!;
    const receipt = receiptAt(r.snapshot, 1)!;
    const served = view.tools.schemas[0]!;
    const edited: LLMToolSchema = { ...served, description: `${served.description} (edited)` };
    expect(receiptHash(receipt.basis.runId, toolDigestInput(edited))).not.toBe(
      receipt.tools.schemaHashes[served.name],
    );
  });
});
