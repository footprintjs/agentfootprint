/**
 * EVERY PRINTED GAP SENTENCE, ASSERTED AGAINST A REAL VIEW (9.88.0, seventh
 * round).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Six review rounds tried to make the sentences a renderer prints beside a
 * rebuilt request unfalsifiable BY WRITING THEM DIFFERENTLY. The sixth round's
 * answer was a reduction: name no module, no function, no key, no version — a
 * sentence with no code claim in it cannot go false when the code changes, so
 * the class is closed.
 *
 * IT IS NOT. Checked one at a time against real runs, TEN of the eleven reduced
 * sentences still make a claim a code edit falsifies. Exactly one does not —
 * `UNGAPPED_FIELDS.gaps` — and it does not because it is SELF-REFERENTIAL: it
 * says what its field is inside the account, not anything about the request.
 * The other ten cannot copy that shape. A sentence that tells a reader
 * something USEFUL — "may be SHORT", "absent means unknown", "the tool list is
 * complete and the schemas are one short" — is a claim about how the rebuild
 * behaves, and the rebuild is code. The reduction changed the VOCABULARY of the
 * claims, not their CLASS.
 *
 * And the same round found a BRAND-NEW false sentence inside the round written
 * to end false sentences. `no-run-log` shipped "The fields below could not be
 * fully recovered here"; driven on the ordinary view that raises it — a
 * grouped agent with one plain tool, its run log emptied — the damaged rebuild
 * is byte-identical to the intact one. Nothing was lost. No rule caught that.
 * A RUN caught it.
 *
 * ── SO: THE POSITION THIS FILE SHIPS ──────────────────────────────────────
 *
 * A gap sentence MAY make a code claim, because a sentence that makes none
 * cannot inform. Every claim it makes is ASSERTED HERE, against a real view
 * that raises the gap. The prose rule (`test/helpers/gapProseClaims.ts`) stays
 * — it keeps the sentences short and readable and gives the enumerations
 * nowhere to come back through — but it is no longer sold as ending the class.
 * The assertion is what ends it.
 *
 * ── HOW A SENTENCE IS BOUND TO ITS ASSERTIONS ─────────────────────────────
 *
 * Each entry below is decomposed into CLAUSES, each clause quoted verbatim from
 * the constant and paired with the run that checks it. Three contract tests
 * hold the binding shut and a fourth labels the one
 * clause class that is about the account, and they are what make this more than a folder of
 * hand-picked examples:
 *
 *   • every key of `SERVED_GAPS` and of `UNGAPPED_FIELDS` is an entry here, and
 *     no entry names a key the catalogue does not have;
 *   • every clause is a verbatim substring of the sentence the catalogue
 *     prints, in the order it appears there;
 *   • the clauses PARTITION the sentence: strike them out and nothing but
 *     punctuation is left. No word of a printed sentence sits outside a clause
 *     that a named test asserts.
 *
 * Rewrite a sentence and the partition fails, which sends the author back here
 * to write the assertion for what it now claims. Add a clause with no
 * assertion and it cannot be added at all — the assertion IS the clause's third
 * field.
 *
 * ── THE ONE BLIND SPOT, SAID PLAINLY ──────────────────────────────────────
 *
 * A CLAIM NOBODY WROTE AN ASSERTION FOR. The partition guarantees each clause
 * has a test; it cannot guarantee the test is as strong as the clause. An
 * assertion that checks less than its clause says leaves the difference
 * unchecked, and no structure in this file can measure that difference — only a
 * person reading the assertion against the clause. That is a smaller and more
 * honest blind spot than six rounds of rewriting produced, and it is the whole
 * of it.
 *
 * Two things this file deliberately does NOT do. It does not check that a gap
 * FIRES on the right recording — `receipt-conformance.test.ts` does that per
 * condition. It does not check that the catalogue's field lists are complete —
 * `gap-catalogue-walk.test.ts` walks that. This file asks only: is what the
 * sentence SAYS true of the view it is printed beside?
 *
 * Test types (Convention 3): contract (the binding above, and one claim per
 * clause) · unit (the value-conditional dials, the two causes) · regression
 * (the measured-false `no-run-log` sentence, pinned by the run that refutes it,
 * and the receipt-quoting sentence that used to print on receipt-less views) ·
 * edge (a crafted recording whose receipt key holds a non-receipt).
 */

import { describe, expect, it } from 'vitest';

import { FlowChartExecutor } from 'footprintjs';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  receiptAt,
  servedAt,
  servedViews,
  RECEIPT_BOUNDARY,
  SERVED_GAPS,
  UNGAPPED_FIELDS,
  type Receipt,
  type ServedGapKind,
  type ServedView,
} from '../../../src/index.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
// The MINT itself, which the public barrel does not carry: one clause below
// needs to hand it a fact no chart in this library supplies, to tell "nobody
// reported a drop" from "the shape cannot hold one".
import { buildReceipt } from '../../../src/lib/time-travel/receipt.js';
// The receipt-LESS shape a shipped chart still produces (9.91.0): a chart
// builder run on the caller's own executor with no run id to salt hashes
// with. The public barrel carries the deps type and not this builder.
import { buildMessageApiChart } from '../../../src/core/agent/buildMessageApiChart.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';

/** Several real runs per test, all of them tiny; the budget is stated. */
const BUDGET = { timeout: 60_000 };

// ─── the provider stub, and the WIRE it records ──────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

/**
 * A scripted provider that keeps a DETACHED copy of every request it was
 * handed. The wire is the third witness in this file — beside the rebuild and
 * the receipt — and it is the only one that is not the library reading its own
 * record, which is what makes "the turns really went out" an assertion rather
 * than a restatement.
 */
function scripted(script: readonly Reply[]): {
  readonly wire: LLMRequest[];
  readonly provider: unknown;
} {
  let i = 0;
  const wire: LLMRequest[] = [];
  return {
    wire,
    provider: {
      name: 'gap-sentence-mock',
      carriesForcedToolChoice: true,
      complete: async (request: LLMRequest): Promise<LLMResponse> => {
        wire.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
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
const call = (id: string, name: string): Reply => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
});
const aTool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

/** One run's recording and the requests that really went out. */
interface Run {
  readonly snapshot: unknown;
  readonly wire: readonly LLMRequest[];
}

/** Run it once, however many clauses ask for it. */
function once(make: () => Promise<Run>): () => Promise<Run> {
  let started: Promise<Run> | undefined;
  return () => (started ??= make());
}

// ─── the runs ────────────────────────────────────────────────────────────

/** A grouped agent with ONE PLAIN TOOL — the shape that refutes the sentence
 *  `no-run-log` used to print. It has no run constant to lose. */
const plainGrouped = once(async () => {
  const { provider, wire } = scripted([call('c1', 'alpha_tool'), answer('done')]);
  const agent = Agent.create({
    provider: provider as never,
    model: 'mock',
    maxIterations: 6,
    reactMode: 'dynamic-grouped',
  })
    .system('you are a bot')
    .tool(aTool('alpha_tool'))
    .build();
  await agent.run({ message: 'go' });
  return { snapshot: agent.getSnapshot()!, wire };
});

/** A grouped agent whose ONLY tool is the forced answer tool, whose name is a
 *  run constant. A `'tool-forced'` output refuses to coexist with registered
 *  tools, so this list is one name long by construction. */
const forcedGrouped = once(async () => {
  const { provider, wire } = scripted([call('1', 'respond_with_schema')]);
  const agent = Agent.create({
    provider: provider as never,
    model: 'mock',
    reactMode: 'dynamic-grouped',
  })
    .system('bot')
    .outputSchema({ safeParse: (v: unknown) => ({ ok: true, value: v }) } as never, {
      strategy: 'tool-forced',
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    })
    .build();
  await agent.run({ message: 'go' });
  return { snapshot: agent.getSnapshot()!, wire };
});

/** An agent that composes a STAGED-REFS NUDGE — the one request-only line this
 *  library writes, and the only line a missing run log can cost. */
async function nudged(grouped: boolean): Promise<Run> {
  const rows = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ vol: i, gb: 18 })));
  const { provider, wire } = scripted([call('c1', 'export_rows'), answer('staged')]);
  const agent = Agent.create({
    provider: provider as never,
    model: 'mock',
    maxIterations: 6,
    artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2000 } },
    ...(grouped && { reactMode: 'dynamic-grouped' as const }),
  } as never)
    .system('You are a storage engineer.')
    .tool(
      defineTool({
        name: 'export_rows',
        description: 'export the rows',
        resultKind: 'dataset/rows',
        execute: () => rows,
      }),
    )
    .tool(
      defineTool<{ dataset: string }, string>({
        name: 'compute',
        description: 'compute over a staged dataset',
        inputSchema: { type: 'object', properties: { dataset: { type: 'string' } } },
        wants: { dataset: 'dataset/rows' },
        execute: () => 'total: 3600',
      }),
    )
    .namesAndNumbersFromEvidence({ nudge: true })
    .build();
  await agent.run({ message: 'stage the rows' });
  return { snapshot: agent.getSnapshot()!, wire };
}

const nudgedGrouped = once(() => nudged(true));
const nudgedFlat = once(() => nudged(false));

/** An agent that SET two dials, and one that set none. */
const dialled = once(async () => {
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
  return { snapshot: agent.getSnapshot()!, wire };
});

const undialled = once(async () => {
  const { provider, wire } = scripted([answer('done')]);
  const agent = Agent.create({ provider: provider as never, model: 'mock' })
    .system('bot')
    .build();
  await agent.run({ message: 'go' });
  return { snapshot: agent.getSnapshot()!, wire };
});

/**
 * A provider DECORATED after the port: it appends to the system prompt, adds a
 * tool nobody registered, and turns a dial the agent never set — all AFTER the
 * receipt was minted.
 *
 * This is the run that makes the boundary a measurement instead of a warning.
 * `wire` here is what the INNER provider was handed, i.e. what really went out.
 */
const decorated = once(async () => {
  const inner = scripted([answer('done')]);
  const provider = {
    name: 'decorated',
    complete: async (request: LLMRequest): Promise<LLMResponse> => {
      const rewritten: LLMRequest = {
        ...request,
        systemPrompt: `${request.systemPrompt ?? ''}\n\n<<injected by a decorator>>`,
        temperature: 0.9,
        tools: [
          ...(request.tools ?? []),
          { name: 'ghost_tool', description: 'never registered', inputSchema: { type: 'object' } },
        ],
      };
      return (inner.provider as { complete: (r: LLMRequest) => Promise<LLMResponse> }).complete(
        rewritten,
      );
    },
  };
  const agent = Agent.create({ provider: provider as never, model: 'mock' })
    .system('bot')
    .build();
  await agent.run({ message: 'go' });
  return { snapshot: agent.getSnapshot()!, wire: inner.wire };
});

/**
 * A run whose CACHE STRATEGY really rewrites the request — the half of the
 * boundary the record CAN see. The rebuild holds the request the strategy was
 * handed; the wire holds the one it handed back.
 */
const rewritingStrategy = once(async () => {
  const { provider, wire } = scripted([answer('done')]);
  const strategy = {
    name: 'rewriting-gap-sentence-strategy',
    prepareRequest: async (request: LLMRequest) => ({
      request: { ...request, systemPrompt: `${request.systemPrompt ?? ''}\n\n<<cached>>` },
      markersApplied: [],
    }),
    readCacheMetrics: () => ({ kind: 'notApplicable' as const, reason: 'test strategy' }),
  };
  const agent = Agent.create({
    provider: provider as never,
    model: 'mock',
    cacheStrategy: strategy as never,
  })
    .system('bot')
    .build();
  await agent.run({ message: 'go' });
  return { snapshot: agent.getSnapshot()!, wire };
});

/** A run that PAUSED and RESUMED — the only shape where a fold base carries
 *  anything, and therefore the only shape where losing it is damage. */
const resumed = once(async () => {
  const { provider, wire } = scripted([call('c1', 'ask_human'), answer('done')]);
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
  if (isPaused(paused)) await agent.resume(paused.checkpoint, 'yes');
  return { snapshot: agent.getSnapshot()!, wire };
});

/**
 * A chart that mints no receipt at all.
 *
 * It was an `LLMCall` until 9.91.0, where that chart started minting one. The
 * receipt-less shape that survives on a SHIPPED chart is a message-API chart
 * builder handed to an executor the caller owns with no run id supplied: every
 * hash on a receipt is salted with the run id, so a chart that cannot be given
 * one declines the mint rather than shipping unsalted fingerprints.
 */
const receiptless = once(async () => {
  const { provider, wire } = scripted([answer('done')]);
  const chart = buildMessageApiChart({
    provider: provider as never,
    model: 'mock',
    systemPrompt: 'you are a probe',
  });
  const executor = new FlowChartExecutor(chart);
  await executor.run({ input: { message: 'the one turn that went out' } });
  return { snapshot: executor.getSnapshot()! as never, wire };
});

// ─── the damages, all of them detached copies ────────────────────────────

type Bundle = { trace: { path: string }[]; overwrite: Record<string, unknown> };
type Log = { commitLog?: Bundle[]; history?: Bundle[]; initialState?: Record<string, unknown> };
type Recording = Log & { subflowResults?: Record<string, { treeContext?: Log }> };

const detach = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One state key gone from every log and every base. */
function stripKey<T>(recording: T, key: string): T {
  const copy = detach(recording) as T & Recording;
  const scrub = (log: Log | undefined): void => {
    if (!log) return;
    for (const bundle of [...(log.commitLog ?? []), ...(log.history ?? [])]) {
      bundle.trace = bundle.trace.filter((t) => t.path !== key);
      delete bundle.overwrite[key];
    }
    if (log.initialState) delete log.initialState[key];
  };
  scrub(copy);
  for (const entry of Object.values(copy.subflowResults ?? {})) scrub(entry?.treeContext);
  return copy;
}

/** One state key REWRITTEN wherever the log wrote it — the crafted damage no
 *  run produces. */
function rewriteKey<T>(recording: T, key: string, value: unknown): T {
  const copy = detach(recording) as T & Recording;
  const rewrite = (log: Log | undefined): void => {
    if (!log) return;
    for (const bundle of [...(log.commitLog ?? []), ...(log.history ?? [])]) {
      if (bundle.trace.some((t) => t.path === key)) bundle.overwrite[key] = value;
    }
    if (log.initialState && key in log.initialState) log.initialState[key] = value;
  };
  rewrite(copy);
  for (const entry of Object.values(copy.subflowResults ?? {})) rewrite(entry?.treeContext);
  return copy;
}

/** Every fold base gone — the shape a recording has when it travelled without
 *  one. */
function stripBases<T>(recording: T): T {
  const copy = detach(recording) as T & Recording;
  delete copy.initialState;
  for (const entry of Object.values(copy.subflowResults ?? {})) {
    if (entry?.treeContext) delete entry.treeContext.initialState;
  }
  return copy;
}

/** The RUN log emptied — a subtree handed in on its own. */
function emptyRunLog<T>(recording: T): T {
  const copy = detach(recording) as T & { commitLog: unknown[] };
  copy.commitLog = [];
  return copy;
}

/** Everything a view holds EXCEPT the account of what it could not prove —
 *  what "the rebuild is unchanged" has to mean. */
const withoutGaps = (view: ServedView): unknown => {
  const { gaps: _gaps, ...rest } = view;
  return rest;
};

const kindsOf = (view: ServedView): readonly string[] => view.gaps.map((g) => g.gap);

/** Every view this file's undamaged runs produce, with its receipt. */
async function everyIntactView(): Promise<
  readonly { readonly view: ServedView; readonly receipt: Receipt | undefined }[]
> {
  const runs = await Promise.all([
    plainGrouped(),
    forcedGrouped(),
    nudgedGrouped(),
    nudgedFlat(),
    dialled(),
    undialled(),
    decorated(),
    resumed(),
    receiptless(),
  ]);
  return runs.flatMap(({ snapshot }) =>
    servedViews(snapshot).map((view) => ({ view, receipt: receiptAt(snapshot, view.epoch) })),
  );
}

// ─── the account: one entry per sentence, one clause per claim ───────────

/** One claim a printed sentence makes, and the run that checks it. */
interface Clause {
  /** Verbatim from the sentence the catalogue prints. */
  readonly quote: string;
  /** What that clause claims, in the words the test is named with. */
  readonly claim: string;
  /** The check. It drives a real run and asserts what the clause says. */
  readonly assert: () => Promise<void> | void;
  /**
   * Set when the clause is about THE ACCOUNT rather than about the request —
   * the category `UNGAPPED_FIELDS.gaps` is in. Such a clause cannot be checked
   * against a view, because it is not a statement about one; what is asserted
   * instead is the structural fact it rests on, and this flag is the label
   * saying so rather than a weaker assertion pretending otherwise.
   */
  readonly aboutTheAccount?: true;
}

interface Entry {
  /** `SERVED_GAPS` kind, or `UNGAPPED_FIELDS` key. */
  readonly site: string;
  /** The sentence, read from the constant — never retyped. */
  readonly sentence: string;
  readonly clauses: readonly Clause[];
}

const gapSentence = (kind: ServedGapKind): string => SERVED_GAPS[kind].why;

const ACCOUNT: readonly Entry[] = [
  // ── cache-transform: on EVERY view, so every clause has to hold on one
  //    with no receipt behind it as well as on one with a cache strategy. ──
  {
    site: 'cache-transform',
    sentence: gapSentence('cache-transform'),
    clauses: [
      {
        quote: 'What reached the provider may differ from the fields below',
        claim: 'a decorated provider really changes the request after the record stops',
        assert: async () => {
          const { snapshot, wire } = await decorated();
          const view = servedAt(snapshot, 1)!;
          expect(kindsOf(view)).toContain('cache-transform');
          // What the model read…
          expect(wire[0]!.systemPrompt).toContain('<<injected by a decorator>>');
          expect(wire[0]!.tools!.map((t) => t.name)).toContain('ghost_tool');
          // …against what the fields below say it read.
          expect(view.system.text).toBe('bot');
          expect(view.tools.names).not.toContain('ghost_tool');
        },
      },
      {
        quote: 'and nothing on this view would show it',
        claim: 'the view carries no trace of the change, whether or not the record does',
        assert: async () => {
          // PAST THE PORT: nothing anywhere shows it. The field whose whole job
          // is to report a rewrite says 'unchanged' — correctly, because the
          // cache strategy changed nothing — and would be read as proof about
          // the wire without this sentence beside it.
          const { snapshot } = await decorated();
          const view = servedAt(snapshot, 1)!;
          expect(JSON.stringify(view)).not.toContain('decorator');
          expect(JSON.stringify(view)).not.toContain('ghost_tool');
          expect(receiptAt(snapshot, 1)!.cache.transform).toBe('unchanged');

          // AT THE STRATEGY: the RECORD does show it, and the clause is about
          // THIS VIEW, so it has to hold here too — asserted at its strongest
          // reading rather than only on the case where nothing shows it at all.
          const rewritten = await rewritingStrategy();
          const rebuilt = servedAt(rewritten.snapshot, 1)!;
          expect(rewritten.wire[0]!.systemPrompt).toContain('<<cached>>');
          expect(rebuilt.system.text).toBe('bot');
          expect(JSON.stringify(rebuilt)).not.toContain('cached');
          // The receipt is where a rewrite IS visible — one reason this entry
          // names the cache fields at all.
          expect(receiptAt(rewritten.snapshot, 1)!.cache.transform).toBe('rewritten');
        },
      },
      {
        quote: 'Where another gap on this view covers one of them, that gap is the stronger claim',
        claim: 'a base-less view carries both gaps on one field, and the other one is the true one',
        assert: async () => {
          const { snapshot } = await resumed();
          const baseless = stripBases(snapshot);
          const view = servedViews(baseless)[0]!;
          // ONE field, TWO gaps naming it.
          expect(SERVED_GAPS['cache-transform'].fields).toContain('system.chars');
          expect(SERVED_GAPS['no-fold-base'].fields).toContain('system.chars');
          expect(kindsOf(view)).toEqual(
            expect.arrayContaining(['cache-transform', 'no-fold-base']),
          );
          // And this entry is the WEAKER of the two: it says the rebuild stops
          // before the strategy, while the other says the rebuild did not get
          // there at all — measured, 0 characters against the receipt's 27.
          expect(view.system.text).toBe('');
          expect(receiptAt(snapshot, 2)!.system.chars).toBe(27);
        },
      },
    ],
  },

  // ── forced-tool-schema ──────────────────────────────────────────────────
  {
    site: 'forced-tool-schema',
    sentence: gapSentence('forced-tool-schema'),
    clauses: [
      {
        quote: 'The schema body behind the forced answer tool is not on this view',
        claim: 'the view holds no schema for the forced tool, while the receipt hashed one',
        assert: async () => {
          const { snapshot } = await forcedGrouped();
          const view = servedAt(snapshot, 1)!;
          expect(kindsOf(view)).toContain('forced-tool-schema');
          const forced = view.tools.forced!;
          expect(view.tools.schemas.map((s) => s.name)).not.toContain(forced);
          // The receipt has the row the rebuild cannot produce — which is what
          // makes this an absence rather than a tool that had no schema.
          expect(Object.keys(receiptAt(snapshot, 1)!.tools.schemaHashes)).toContain(forced);
        },
      },
      {
        quote: 'Its name is',
        claim: 'the forced tool is named on the view, twice over',
        assert: async () => {
          const { snapshot } = await forcedGrouped();
          const view = servedAt(snapshot, 1)!;
          expect(view.tools.forced).toBe('respond_with_schema');
          expect(view.tools.names).toContain('respond_with_schema');
        },
      },
      {
        quote: 'so the tool list is complete and the schemas beside it are one short',
        claim: 'names match the receipt exactly and the schemas are short by exactly one',
        assert: async () => {
          const { snapshot, wire } = await forcedGrouped();
          const view = servedAt(snapshot, 1)!;
          const receipt = receiptAt(snapshot, 1)!;
          // COMPLETE: every name that went out is on the view.
          expect([...view.tools.names]).toEqual([...receipt.tools.names]);
          expect([...view.tools.names]).toEqual(wire[0]!.tools!.map((t) => t.name));
          // ONE SHORT: the schemas are the names minus the forced one.
          expect(view.tools.names.length).toBe(1);
          expect(view.tools.schemas.length).toBe(0);
          expect(view.tools.schemas.length).toBe(view.tools.names.length - 1);
        },
      },
    ],
  },

  // ── provider-defaults: the only entry that quotes the boundary ──────────
  {
    site: 'provider-defaults',
    sentence: gapSentence('provider-defaults'),
    clauses: [
      {
        quote: 'A dial absent below was not recorded',
        claim: 'params is value-conditional — a dial nobody set writes no key at all',
        assert: async () => {
          const set = await dialled();
          const unset = await undialled();
          // Set: the key is there with the value that went out.
          expect(receiptAt(set.snapshot, 1)!.params.temperature).toBe(0.25);
          expect(receiptAt(set.snapshot, 1)!.params.maxTokens).toBe(512);
          // Unset: no key, rather than a default the library never sent.
          expect(receiptAt(unset.snapshot, 1)!.params).toEqual({});
          expect('temperature' in receiptAt(unset.snapshot, 1)!.params).toBe(false);
          expect(kindsOf(servedAt(unset.snapshot, 1)!)).toContain('provider-defaults');
        },
      },
      {
        quote: 'that is not the same as the model running without one',
        claim: 'the model really ran at a temperature the record does not carry',
        assert: async () => {
          const { snapshot, wire } = await decorated();
          // The record says no dial was set…
          expect(receiptAt(snapshot, 1)!.params).toEqual({});
          // …and the model was handed one anyway.
          expect(wire[0]!.temperature).toBe(0.9);
        },
      },
      {
        quote: 'A receipt describes the request as this library last saw it',
        claim: 'this sentence is printed only where a receipt exists to describe anything',
        assert: async () => {
          // The premise of the quoted boundary, asserted rather than assumed:
          // `cache-transform` carried it until this round and is on EVERY view,
          // including receipt-less ones, where it told a reader about a thing
          // that is not there.
          expect(SERVED_GAPS['cache-transform'].why).not.toContain(RECEIPT_BOUNDARY);
          for (const { view, receipt } of await everyIntactView()) {
            const quotes = view.gaps.some((g) => g.why.includes(RECEIPT_BOUNDARY));
            if (quotes) {
              expect(
                receipt,
                `${view.callRuntimeStageId} quotes the boundary with no receipt`,
              ).toBeDefined();
              expect(view.basis).toBeDefined();
            }
          }
          // …and the receipt-less chart really is one of the views walked above.
          const bare = servedAt((await receiptless()).snapshot, 1)!;
          expect(bare.basis).toBeUndefined();
          expect(bare.gaps.some((g) => g.why.includes(RECEIPT_BOUNDARY))).toBe(false);
        },
      },
      {
        quote:
          'Whatever handled it after that could have changed it, and nothing on the receipt ' +
          'would show that',
        claim: 'the receipt reads unchanged while three parts of the request had moved',
        assert: async () => {
          const { snapshot, wire } = await decorated();
          const receipt = receiptAt(snapshot, 1)!;
          expect(receipt.cache.transform).toBe('unchanged');
          expect(receipt.cache.transformHash).toBeNull();
          expect(receipt.tools.names).not.toContain('ghost_tool');
          expect(receipt.params.temperature).toBeUndefined();
          expect(wire[0]!.systemPrompt).toContain('<<injected by a decorator>>');
          expect(wire[0]!.temperature).toBe(0.9);
        },
      },
    ],
  },

  // ── no-fold-base ────────────────────────────────────────────────────────
  {
    site: 'no-fold-base',
    sentence: gapSentence('no-fold-base'),
    clauses: [
      {
        quote: 'The fields below are unproven and may be SHORT',
        claim: 'a resumed run with its base gone rebuilds less than it sent',
        assert: async () => {
          const { snapshot } = await resumed();
          const before = servedViews(snapshot)[0]!;
          const after = servedViews(stripBases(snapshot))[0]!;
          expect(kindsOf(after)).toContain('no-fold-base');
          expect(before.system.text).toContain('SYSTEM_MARKER');
          expect(after.system.text.length).toBeLessThan(before.system.text.length);
          expect(after.messages.asSent.length).toBeLessThan(before.messages.asSent.length);
          expect(after.tools.names.length).toBeLessThan(before.tools.names.length);
        },
      },
      {
        quote: 'a count can be lower than what really went out',
        claim: 'the counts the receipt minted are higher than the ones the rebuild reports',
        assert: async () => {
          const { snapshot, wire } = await resumed();
          const after = servedViews(stripBases(snapshot))[0]!;
          const receipt = receiptAt(snapshot, 2)!;
          // The receipt's numbers, and the wire's, both say more than the
          // rebuild does.
          expect(receipt.system.chars).toBe(27);
          expect(after.system.text.length).toBe(0);
          expect(receipt.messages.count).toBe(3);
          expect(after.messages.asSent.length).toBe(1);
          expect(wire[1]!.messages.length).toBe(3);
        },
      },
      {
        quote: 'and a value that could not be recovered reads as empty rather than as unknown',
        claim: 'the unrecoverable fields come back empty, which is why they need saying',
        assert: async () => {
          const after = servedViews(stripBases((await resumed()).snapshot))[0]!;
          // Empty containers and an empty string — not `undefined`, not a
          // marker. Indistinguishable from a call that really sent none.
          expect(after.system.text).toBe('');
          expect(after.system.pieces).toEqual([]);
          expect(after.tools.names).toEqual([]);
          expect(after.tools.schemas).toEqual([]);
        },
      },
      {
        quote:
          "The turn number below may be this turn's place in run order rather than the number " +
          'the run itself gave it',
        claim: 'the second turn is numbered 1 by position while the run itself called it 2',
        assert: async () => {
          const { snapshot } = await resumed();
          // Intact: both records agree the resumed snapshot holds turn 2.
          expect(servedViews(snapshot).map((v) => v.epoch)).toEqual([2]);
          expect(receiptAt(snapshot, 2)!.basis.epoch).toBe(2);
          // Damaged: the base AND the run's own count are gone, so the fold
          // numbers the turn by where it sits.
          const damaged = stripKey(stripBases(snapshot), 'iteration');
          const rebuilt = servedViews(damaged);
          expect(rebuilt.map((v) => v.epoch)).toEqual([1]);
          expect(kindsOf(rebuilt[0]!)).toContain('no-fold-base');
          // …and the number the run itself gave it is still on the record.
          expect(receiptAt(damaged, 1)!.basis.epoch).toBe(2);
        },
      },
    ],
  },

  // ── no-conversation-on-record ───────────────────────────────────────────
  {
    site: 'no-conversation-on-record',
    sentence: gapSentence('no-conversation-on-record'),
    clauses: [
      {
        quote: 'The turns that went out are unknown, not empty',
        claim: 'the rebuild reports no turns for a call the wire shows carried three',
        assert: async () => {
          const { snapshot, wire } = await nudgedFlat();
          const damaged = stripKey(stripKey(snapshot, 'history'), 'messagesInjections');
          const view = servedViews(damaged)[1]!;
          expect(kindsOf(view)).toContain('no-conversation-on-record');
          expect(view.messages.asSent).toEqual([]);
          // The call really did carry a conversation — three turns of it.
          expect(wire[1]!.messages.length).toBeGreaterThan(0);
          expect(receiptAt(snapshot, 2)!.messages.entries.length).toBe(3);
        },
      },
      {
        quote: 'an empty list here is the absence of a record, never a record of absence',
        claim: 'the same run reports three turns when the record is intact',
        assert: async () => {
          const { snapshot } = await nudgedFlat();
          const intact = servedViews(snapshot)[1]!;
          expect(intact.messages.asSent.length).toBe(3);
          expect(kindsOf(intact)).not.toContain('no-conversation-on-record');
          // So `[]` on the damaged rebuild is what this recording lost, not
          // what this call sent.
          const damaged = stripKey(stripKey(snapshot, 'history'), 'messagesInjections');
          expect(servedViews(damaged)[1]!.messages.asSent).toEqual([]);
        },
      },
      {
        quote: 'The request-only lines are unproved with them',
        claim: 'the nudge that really went out is gone from the rebuild with the conversation',
        assert: async () => {
          const { snapshot, wire } = await nudgedFlat();
          const intact = servedViews(snapshot)[1]!;
          expect(intact.messages.requestOnly.map((l) => l.reason)).toEqual(['staged-refs-nudge']);
          // It was on the wire, as the last line of the request.
          const sent = wire[1]!.messages.at(-1) as LLMMessage;
          expect(sent.content).toBe(intact.messages.requestOnly[0]!.text);
          // And with no conversation to read, the rebuild reports none.
          const damaged = stripKey(stripKey(snapshot, 'history'), 'messagesInjections');
          expect(servedViews(damaged)[1]!.messages.requestOnly).toEqual([]);
        },
      },
    ],
  },

  // ── no-run-log: the sentence a run measured FALSE ───────────────────────
  {
    site: 'no-run-log',
    sentence: gapSentence('no-run-log'),
    clauses: [
      {
        quote: 'The fields below may be SHORT',
        claim: 'MAY, and not DID — the same damage costs a name on one run and nothing on another',
        assert: async () => {
          // THE REGRESSION. This entry shipped "could not be fully recovered
          // here", and this is the run that refutes it: the gap fires and the
          // rebuild is unchanged, field for field.
          const plain = await plainGrouped();
          const intactPlain = servedViews(plain.snapshot);
          const damagedPlain = servedViews(emptyRunLog(plain.snapshot));
          expect(damagedPlain.every((v) => kindsOf(v).includes('no-run-log'))).toBe(true);
          expect(damagedPlain.map(withoutGaps)).toEqual(intactPlain.map(withoutGaps));

          // And this is the run where the same damage really costs something.
          const forced = await forcedGrouped();
          const damagedForced = servedViews(emptyRunLog(forced.snapshot))[0]!;
          expect(damagedForced.tools.names).toEqual([]);
          expect(servedViews(forced.snapshot)[0]!.tools.names).toEqual(['respond_with_schema']);
        },
      },
      {
        quote: 'a name can be missing from the tool list',
        claim: 'the forced tool goes off the list, and the wire shows it went out',
        assert: async () => {
          const { snapshot, wire } = await forcedGrouped();
          const intact = servedViews(snapshot)[0]!;
          const damaged = servedViews(emptyRunLog(snapshot))[0]!;
          expect(wire[0]!.tools!.map((t) => t.name)).toEqual(['respond_with_schema']);
          expect(intact.tools.names).toEqual(['respond_with_schema']);
          expect(intact.tools.forced).toBe('respond_with_schema');
          expect(damaged.tools.names).toEqual([]);
          expect(damaged.tools.forced).toBeUndefined();
        },
      },
      {
        quote: 'and a line that went out with the request can be missing too',
        claim: 'the staged-refs line the wire carried is absent from the damaged rebuild',
        assert: async () => {
          const { snapshot, wire } = await nudgedGrouped();
          const intact = servedViews(snapshot)[1]!;
          const damaged = servedViews(emptyRunLog(snapshot))[1]!;
          // It really went out — the last message of the second request.
          const sent = wire[1]!.messages.at(-1) as LLMMessage;
          expect(sent.role).toBe('user');
          expect(sent.content).toBe(intact.messages.requestOnly[0]!.text);
          // …and it is not a turn of the conversation, which is why "a line
          // from the conversation" was the wrong way to say this.
          expect(intact.messages.asSent.map((m) => m.content)).not.toContain(sent.content);
          expect(damaged.messages.requestOnly).toEqual([]);
        },
      },
      {
        quote: 'An absence below is not evidence that there was nothing there',
        claim: 'two runs raise the gap with identical absences and only one of them lost anything',
        assert: async () => {
          const plain = servedViews(emptyRunLog((await plainGrouped()).snapshot))[0]!;
          const forced = servedViews(emptyRunLog((await forcedGrouped()).snapshot))[0]!;
          // Both carry the gap; both report no forced tool.
          expect(kindsOf(plain)).toContain('no-run-log');
          expect(kindsOf(forced)).toContain('no-run-log');
          expect(plain.tools.forced).toBeUndefined();
          expect(forced.tools.forced).toBeUndefined();
          // One of them never had one; the other had one and lost it. The
          // absence looks the same on both, which is the whole claim.
          expect(servedViews((await plainGrouped()).snapshot)[0]!.tools.forced).toBeUndefined();
          expect(servedViews((await forcedGrouped()).snapshot)[0]!.tools.forced).toBe(
            'respond_with_schema',
          );
        },
      },
      {
        quote: 'read the whole recording rather than a piece of it',
        claim: 'the whole recording recovers both, and raises no such gap',
        assert: async () => {
          const forced = servedViews((await forcedGrouped()).snapshot)[0]!;
          const nudge = servedViews((await nudgedGrouped()).snapshot)[1]!;
          expect(kindsOf(forced)).not.toContain('no-run-log');
          expect(kindsOf(nudge)).not.toContain('no-run-log');
          expect(forced.tools.names).toEqual(['respond_with_schema']);
          expect(nudge.messages.requestOnly.map((l) => l.reason)).toEqual(['staged-refs-nudge']);
        },
      },
    ],
  },

  // ── no-receipt-on-chart ─────────────────────────────────────────────────
  {
    site: 'no-receipt-on-chart',
    sentence: gapSentence('no-receipt-on-chart'),
    clauses: [
      {
        quote: 'Nothing on this view has been checked against what went out',
        claim: 'there is no receipt to check against, under either cause, and the call still went',
        assert: async () => {
          const { snapshot, wire } = await receiptless();
          const view = servedAt(snapshot, 1)!;
          expect(receiptAt(snapshot, 1)).toBeUndefined();
          expect(view.gaps.find((g) => g.gap === 'no-receipt-on-chart')!.cause).toBe(
            'no-receipt-committed',
          );
          // The other cause, on a crafted recording: a value under the receipt
          // key that is not a receipt. Same sentence, same absence of a check.
          const damaged = rewriteKey((await plainGrouped()).snapshot, 'receipt', {
            system: { hash: 'x', chars: 1, pieces: [] },
          });
          const refused = servedViews(damaged)[0]!;
          expect(refused.gaps.find((g) => g.gap === 'no-receipt-on-chart')!.cause).toBe(
            'receipt-shape-rejected',
          );
          // …and the call itself plainly happened.
          expect(wire).toHaveLength(1);
        },
      },
      {
        quote: 'Every field below is missing as a whole',
        claim: 'not one of the fields the gap names is anywhere on the view',
        assert: async () => {
          const { snapshot } = await receiptless();
          const view = servedAt(snapshot, 1)!;
          // MISSING AS A RECORD, not merely missing from the view: `params` and
          // the `cache.*` fields never appear on a view at all, so what makes
          // them absent HERE is that there is no receipt carrying them either.
          expect(receiptAt(snapshot, 1)).toBeUndefined();
          expect(view.basis).toBeUndefined();
          const holder = view as unknown as Record<string, unknown>;
          for (const field of SERVED_GAPS['no-receipt-on-chart'].fields) {
            const head = field.split('.')[0]!;
            expect(holder[head], `${field} is on a view that has no receipt`).toBeUndefined();
          }
          // Spelled out, because a loop over a field list can pass on an empty
          // list: the three containers a receipt would have brought.
          expect(Object.keys(view)).not.toContain('params');
          expect(Object.keys(view)).not.toContain('cache');
          expect(Object.keys(view)).not.toContain('basis');
        },
      },
      {
        quote: 'and an absence among them says nothing about the call',
        claim: 'the same absence sits on a call that had a model, a provider and a prompt',
        assert: async () => {
          const { snapshot, wire } = await receiptless();
          const view = servedAt(snapshot, 1)!;
          // No basis on the view…
          expect(view.basis).toBeUndefined();
          // …and a call that went out with all of it, provably.
          expect(wire[0]!.systemPrompt).toBe('you are a probe');
          expect(wire[0]!.messages.length).toBeGreaterThan(0);
          expect(view.system.text).toBe('you are a probe');
        },
      },
      {
        quote: 'not even that a dial was left unset',
        claim: 'an unset dial and an unrecorded one look the same, so neither can be read here',
        assert: async () => {
          // A receipt ALWAYS carries `params`, so an absence one level down —
          // no `temperature` key — really is "the call went out without one".
          // That is the reading this clause refuses to license on a view with
          // no receipt, where the container itself is gone…
          expect(receiptAt((await undialled()).snapshot, 1)!.params).toEqual({});
          // …and the reading is not safe even where the container IS there:
          // measured, the same empty `params` sits on a call the model saw at
          // temperature 0.9.
          expect(receiptAt((await decorated()).snapshot, 1)!.params).toEqual({});
          expect((await decorated()).wire[0]!.temperature).toBe(0.9);
          const bare = servedAt((await receiptless()).snapshot, 1)!;
          expect((bare as unknown as Record<string, unknown>)['params']).toBeUndefined();
        },
      },
    ],
  },

  // ── UNGAPPED_FIELDS ─────────────────────────────────────────────────────
  {
    site: 'omittedForAttention',
    sentence: UNGAPPED_FIELDS['omittedForAttention']!,
    clauses: [
      {
        quote: 'Absent means nobody recorded a drop, never that nothing was dropped',
        claim: 'the mint carries the fact when it is handed one, and no run hands it one',
        assert: async () => {
          for (const { receipt } of await everyIntactView()) {
            expect(receipt?.omittedForAttention).toBeUndefined();
          }
          // The field is not vestigial and the shape does not refuse it: hand
          // the mint a drop and the receipt carries it. So an absence is the
          // absence of a REPORT, exactly as the sentence says.
          //
          // AS STRONG AS THIS LIBRARY LETS IT BE, and no stronger: the run that
          // would pin the second half outright — something WAS dropped and the
          // receipt is silent — cannot be driven here, because the built-in
          // slots evict and truncate nothing. An over-budget slot writes a
          // pressure record and sends the whole content anyway, so its record
          // reports zero drops on every run. What is asserted is the shape's
          // half; the remainder is a claim nobody could write a run for, and
          // this comment is where that is said.
          const minted = buildReceipt({
            runId: 'run-1',
            epoch: 1,
            model: 'mock',
            provider: 'mock',
            systemText: 'bot',
            systemPieces: [],
            messages: [],
            requestOnly: [],
            tools: [],
            forced: null,
            withheld: null,
            baseRequest: {},
            preparedRequest: {},
            omittedForAttention: { count: 2, summaries: ['a', 'b'] },
          });
          expect(minted.omittedForAttention).toBeDefined();
        },
      },
      {
        quote: 'No limit of this rebuild explains it, so no gap names it',
        claim: 'it is absent on views that HAVE a receipt too, and no gap claims it',
        assert: async () => {
          const withReceipts = (await everyIntactView()).filter((r) => r.receipt !== undefined);
          expect(withReceipts.length).toBeGreaterThan(0);
          for (const { receipt } of withReceipts) {
            expect(receipt!.omittedForAttention).toBeUndefined();
          }
          const naming = Object.entries(SERVED_GAPS).filter(([, gap]) =>
            gap.fields.some((f) => f === 'omittedForAttention'),
          );
          expect(naming.map(([kind]) => kind)).toEqual([]);
        },
      },
    ],
  },
  {
    site: 'callRuntimeStageId',
    sentence: UNGAPPED_FIELDS['callRuntimeStageId']!,
    clauses: [
      {
        quote: 'Never absent here',
        claim: 'every view of every run carries it, damaged recordings included',
        assert: async () => {
          const intact = (await everyIntactView()).map((r) => r.view);
          const plain = (await plainGrouped()).snapshot;
          const resume = (await resumed()).snapshot;
          const damaged = [
            ...servedViews(emptyRunLog(plain)),
            ...servedViews(stripBases(resume)),
            ...servedViews(stripKey(plain, 'receipt')),
            ...servedViews(stripKey(stripKey(plain, 'history'), 'messagesInjections')),
          ];
          expect(damaged.length).toBeGreaterThan(0);
          for (const view of [...intact, ...damaged]) {
            expect(typeof view.callRuntimeStageId).toBe('string');
            expect(view.callRuntimeStageId.length).toBeGreaterThan(0);
          }
        },
      },
      {
        quote: 'so there is nothing about it for a gap to excuse',
        claim: 'no gap in the catalogue names it',
        assert: () => {
          const naming = Object.entries(SERVED_GAPS).filter(([, gap]) =>
            gap.fields.some((f) => f === 'callRuntimeStageId'),
          );
          expect(naming.map(([kind]) => kind)).toEqual([]);
        },
      },
    ],
  },
  {
    site: 'gaps',
    sentence: UNGAPPED_FIELDS['gaps']!,
    clauses: [
      {
        quote: 'The account itself rather than a fact about the request',
        claim: 'RECORDED, not asserted: this clause is about the account, and the list is real',
        aboutTheAccount: true,
        assert: async () => {
          // There is nothing here to check against a request, because the
          // clause makes no claim about one — which is exactly why it is the
          // only sentence in the catalogue that no code edit can falsify. What
          // IS checkable is that the field it describes is the account: every
          // view carries one, and it is never empty.
          for (const { view } of await everyIntactView()) {
            expect(Array.isArray(view.gaps)).toBe(true);
            expect(view.gaps.length).toBeGreaterThan(0);
          }
        },
      },
      {
        quote: 'a gap naming this list would be the account excusing its own absence',
        claim: 'no gap names it, on any run',
        aboutTheAccount: true,
        assert: async () => {
          const naming = Object.entries(SERVED_GAPS).filter(([, gap]) =>
            gap.fields.some((f) => f === 'gaps' || f.startsWith('gaps.')),
          );
          expect(naming.map(([kind]) => kind)).toEqual([]);
          for (const { view } of await everyIntactView()) {
            for (const gap of view.gaps) {
              expect(gap.fields).not.toContain('gaps');
            }
          }
        },
      },
    ],
  },
];

// ─── Contract: the binding between a sentence and its assertions ─────────

describe('every printed sentence is decomposed into clauses that are asserted', () => {
  it('covers every catalogue entry and invents none', () => {
    const sites = ACCOUNT.map((e) => e.site).sort();
    const expected = [...Object.keys(SERVED_GAPS), ...Object.keys(UNGAPPED_FIELDS)].sort();
    // The failure message IS the fix instruction: a new gap kind or a new
    // excused field needs an entry here with an assertion per clause, or its
    // sentence is printed to a reader with nothing checking it.
    expect(sites).toEqual(expected);
  });

  it('every clause is quoted verbatim from the sentence the catalogue prints', () => {
    const wrong: string[] = [];
    for (const entry of ACCOUNT) {
      for (const clause of entry.clauses) {
        if (!entry.sentence.includes(clause.quote)) {
          wrong.push(`${entry.site}: "${clause.quote}" is not in the sentence`);
        }
      }
    }
    // A quote that has drifted is a clause whose assertion is checking a claim
    // nobody prints any more.
    expect(wrong).toEqual([]);
  });

  it('the clauses PARTITION the sentence — no word is left unasserted', () => {
    // THE GUARD THAT MAKES THIS FILE A WALK RATHER THAN A SAMPLE. Strike every
    // quoted clause out of the sentence and what remains must be punctuation.
    // A sentence that grows a new claim leaves a word behind and fails here,
    // which sends the author back to write the assertion for it.
    const leftovers: string[] = [];
    for (const entry of ACCOUNT) {
      let rest = entry.sentence;
      let cursor = 0;
      for (const clause of entry.clauses) {
        const at = rest.indexOf(clause.quote, cursor);
        if (at < 0) {
          leftovers.push(`${entry.site}: clauses are out of order at "${clause.quote}"`);
          break;
        }
        rest = `${rest.slice(0, at)} ${rest.slice(at + clause.quote.length)}`;
        cursor = at + 1;
      }
      const words = rest.split(/[\s.,;:—–-]+/).filter((w) => w.length > 0);
      if (words.length > 0) leftovers.push(`${entry.site}: unasserted — ${words.join(' ')}`);
    }
    expect(leftovers).toEqual([]);
  });

  it('the one clause class that is NOT a claim about the request is labelled', () => {
    // The finding this round records rather than fixes. `UNGAPPED_FIELDS.gaps`
    // is the only sentence in the catalogue no code edit can falsify, and it is
    // self-referential: it says what its field is INSIDE the account. That is
    // not a template the other ten can copy — a sentence that tells a reader
    // something useful about the request is a claim about the rebuild, and the
    // rebuild is code. So the flag names the category instead of pretending an
    // assertion covers it.
    const labelled = ACCOUNT.filter((e) => e.clauses.some((c) => c.aboutTheAccount === true));
    expect(labelled.map((e) => e.site)).toEqual(['gaps']);
    expect(ACCOUNT.find((e) => e.site === 'gaps')!.clauses.every((c) => c.aboutTheAccount)).toBe(
      true,
    );
  });
});

// ─── Contract: one test per clause ───────────────────────────────────────

for (const entry of ACCOUNT) {
  describe(`${entry.site} — what its sentence claims`, () => {
    it('is the sentence the catalogue prints, not a copy of it', () => {
      const printed =
        entry.site in SERVED_GAPS
          ? SERVED_GAPS[entry.site as ServedGapKind].why
          : UNGAPPED_FIELDS[entry.site];
      expect(entry.sentence).toBe(printed);
      expect(entry.sentence.length).toBeGreaterThan(40);
    });

    for (const clause of entry.clauses) {
      it(`${clause.claim} — "${clause.quote}"`, BUDGET, clause.assert);
    }
  });
}
