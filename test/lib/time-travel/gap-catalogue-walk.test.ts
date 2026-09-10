/**
 * THE WALK — every field a `Receipt` and a `ServedView` carry, crossed against
 * the gap catalogue, with nowhere for an unnamed field to hide (9.88.0).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * `SERVED_GAPS` is the catalogue of what a rebuild cannot prove. Three rounds
 * of review checked it the only way anybody had: by reading the two shapes,
 * reading the catalogue, and pairing them up in their head. Three rounds, three
 * misses — `no-fold-base` short by two fields, then short again, and a
 * docstring that asserted about those exact fields that the rebuild "produces
 * them and they DO agree with the receipt", which is false on every view that
 * raises `no-fold-base` (measured: receipt 27 system chars over 3 turns, view 0
 * over 1).
 *
 * Every one of those rounds was careful. That is the finding: A HAND-COUNTED
 * LIST IS SHORT THE DAY AFTER, and this library has fixed the same defect the
 * same way every time since 9.86 — `userTurnProducers.test.ts` walks every
 * `role:'user'` producer, `modelFacingScan.test.ts` walks every string literal,
 * `toolDivergenceWalk.test.ts` crosses every claimant. This is that walk for
 * the catalogue.
 *
 * ── WHAT IT WALKS ─────────────────────────────────────────────────────────
 *
 * The field list is DERIVED twice, from two directions that fail differently:
 *
 *   • STATICALLY, from the declarations. The TypeScript parser reads `Receipt`
 *     and `ServedView` out of `receipt.ts` and `servedView.ts` and expands them
 *     to leaf paths (`system.chars`, `messages.count`, `params.maxTokens`, …),
 *     descending into any interface DECLARED IN THOSE TWO FILES and stopping at
 *     anything else — an `LLMMessage` is somebody else's shape, and the
 *     catalogue names the container that holds it. This half sees a field no
 *     run produces: `omittedForAttention` is on the shape and, measured, no
 *     chart supplies it.
 *   • AT RUNTIME, from real runs. Five agents are driven by a real provider
 *     stub — tools and dials, a wrap-up call that withholds every tool, a
 *     tool-forced output, a staged-refs nudge, an `LLMCall` chart — and the
 *     receipts and views they actually produce are walked to leaf paths. This
 *     half sees a field the static walk mis-read, and it is what turns the
 *     static list from a claim about the source into a fact about the values.
 *
 * A runtime path the static walk does not know is a FAILURE, not a warning:
 * either the declarations are wrong or the walk is. Paths BELOW a declared leaf
 * are not new fields and are truncated to it — a `Record`'s data keys
 * (`tools.schemaHashes.alpha_tool`) and the inside of somebody else's shape
 * (`messages.asSent[i].role`, an `LLMMessage`) — because the static half is
 * what owns where this shape stops being ours.
 *
 * Then, in these directions:
 *
 *   • COVERAGE — every enumerated field is named by at least one `SERVED_GAPS`
 *     entry's `fields`, or is a key of `UNGAPPED_FIELDS` with its reason. A
 *     field in neither fails BY NAME, with both ways to satisfy it printed;
 *   • RESOLUTION — every `fields` entry and every `UNGAPPED_FIELDS` key
 *     resolves to a real field on one of the two shapes, so a rename cannot
 *     leave a gap pointing at nothing. That is the same rot as a `file:line`
 *     pointer, which this repo already bans;
 *   • REACHABILITY — every gap kind `viewOf` can push is in the catalogue and
 *     vice versa: no orphan kind, no unreachable entry;
 *   • THE PROSE ITSELF — every `why` and every `UNGAPPED_FIELDS` reason is put
 *     through `test/helpers/gapProseClaims.ts`, the reader-facing sibling of
 *     `modelFacingClaims.ts`. A gap sentence may say WHICH FIELDS it covers,
 *     WHAT COULD NOT BE ESTABLISHED and WHAT THEREFORE FOLLOWS; it may not
 *     count the causes, rule them benign, promise the reader can tell them
 *     apart, or say what another module does. Those four shapes are what five
 *     review rounds of this release actually produced, one of them in the
 *     sentence the round before had just written. The doc copies' `why` cells
 *     are judged too, one row weaker — see that file's header for the argument;
 *   • THE PROSE COPIES — the two hand-written gap tables (`src/lib/time-travel/
 *     README.md`, `docs-next/…/time-travel.mdx`) are parsed and required to
 *     restate `SERVED_GAPS` exactly, kind for kind and field for field. They
 *     were short AND over-broad on the day 9.88.0 was written — `no-run-log`
 *     missing `tools.schemaHashes`, `cache-transform` claiming all of `tools.*`
 *     when it names two of the four — which is this file's own defect one layer
 *     out, where nothing was looking. A doc that restates a frozen exported
 *     constant should be CHECKED against it, not retyped.
 *
 * Coverage is by PREFIX: a gap that names `system.pieces` covers
 * `system.pieces.slot`, and one that names `params` covers every dial. Naming a
 * container is a real claim about everything in it.
 *
 * ── AND A FOURTH, BECAUSE THE FIRST THREE WERE NOT ENOUGH ─────────────────
 *
 * Written and run, the three above caught ONE of the two defects they were
 * built for, and the miss is worth more than the hit.
 *
 * They caught the missing receipt: nothing in the catalogue named `basis.model`
 * / `basis.provider` / `basis.runId` (nor `omittedForAttention`), so COVERAGE
 * failed by name and the fix had to be a gap or a written reason.
 *
 * They did NOT catch the short `no-fold-base`. `system.chars` and
 * `messages.count` were named — by `cache-transform`, which names them for a
 * completely different reason — so every field was accounted for and the
 * account was still wrong: the gap that describes the MECHANISM did not name
 * the fields the mechanism breaks. No static question can tell those apart.
 *
 * So this file has a DIVERGENCE half as well, and that half is what makes it a
 * walk rather than a checklist: damage a real recording the way each gap
 * describes, rebuild, diff the view field by field against the intact one, and
 * require every field that MOVED to be named by the gap that damage raises.
 * Two things had to be right before it bit, and both are recorded where they
 * are made: the damage has to be a RESUMED run (on a run that never paused,
 * deleting `initialState` changes nothing — measured), and a view field that
 * maps to two receipt fields has to require BOTH (`some` left the short list
 * green; `every` names it). Verified by reverting each fix and watching the
 * right row go red.
 *
 * ── HOW MUCH OF EACH GAP THE DIVERGENCE HALF ACTUALLY REACHES ─────────────
 *
 * MEASURED, per row, and pinned by a test below so this table cannot go stale
 * the way a hand-counted one does:
 *
 *   no-fold-base                 7 of 11 named fields move
 *   no-conversation-on-record    3 of 3
 *   no-receipt-on-chart          3 of 8
 *   no-run-log                   1 of 4
 *
 * `no-conversation-on-record` is the only row that reaches every field its gap
 * names, and it is also the shortest list. The rest are PARTIAL for structural
 * reasons rather than for want of a better damage: a receipt-only field
 * (`params`, `cache.*`, `basis.epoch`) never appears on a view at all, so
 * removing the receipt cannot MOVE it; `tools.forced` and `tools.withheld` need
 * a forced output and a wrap-up call, and none of these runs is either;
 * `no-fold-base`'s `epoch` needs a recording whose `iteration` writes are gone
 * TOO, which `receipt-conformance.test.ts` constructs and this damage does not;
 * and `no-run-log`'s three tool fields need a run whose tool list comes from a
 * run constant.
 *
 * SO SAY IT PLAINLY: a field claim this half does not reach is carried by the
 * COVERAGE half above and by `receipt-conformance.test.ts`, which drives each
 * condition on a real run — NOT by divergence. A previous version of this
 * header said the vacuous-row guard was closed "by driving each row on a run
 * that reaches its own fields", and that clause was false the day it was
 * written: three of the four rows reach a subset. What the guard really proves
 * is that each row moves SOMETHING, which is the difference between a
 * measurement and a green square.
 *
 * ── WHAT A GREEN RUN PROVES, AND WHAT IT DOES NOT ─────────────────────────
 *
 * Proves: every field of both shapes is ACCOUNTED FOR — some entry in the
 * catalogue names it, or somebody wrote down why it needs no entry — and every
 * pointer in the catalogue lands on a field that exists.
 *
 * Proves, additionally: for the four damages it can apply, no field moves
 * without the responsible gap naming it.
 *
 * Proves, additionally: no sentence in the catalogue has one of the four shapes
 * that go false without an edit.
 *
 * Does NOT prove that the account is TRUE. A gap can name a field for the wrong
 * reason and this walk will call it covered; a `why` can be structurally clean
 * and still describe the wrong mechanism; an `UNGAPPED_FIELDS` reason can be
 * wishful. Only a person reading the `why` catches that, which is exactly how
 * the defect this file exists to prevent was found in the first place. The
 * narrower blind spots, named rather than left to be discovered:
 *
 *   • the gap-kind half reads `gapOf('…')` calls out of `servedView.ts`'s
 *     source. A kind pushed some other way is invisible to it — so the walk
 *     also fails on any `gapOf` call whose argument is not a string literal,
 *     which is the only shape that could hide one;
 *   • a gap is checked for EXISTENCE, never for firing on the right run. That
 *     is `receipt-conformance.test.ts`'s job, per condition;
 *   • the static half follows type references by NAME within the two files. A
 *     field reached through a type alias, a mapped type or an intersection is
 *     not expanded, and would be enumerated only if a real run produced it;
 *   • the runtime half can only produce what its five scenarios reach. A new
 *     value-conditional field that no scenario triggers is caught by the static
 *     half alone;
 *   • the DAMAGES table is hand-listed, like the divergence walk's own
 *     narrowings. A gap whose damage nobody wrote down gets the coverage check
 *     and not the divergence one — which is precisely the weaker position the
 *     short `no-fold-base` sat in;
 *   • A DAMAGE ROW THAT DAMAGES NOTHING passed as a green row for one release.
 *     The divergence check asks "is every field that MOVED named?", and on a
 *     run where nothing moves the answer is trivially yes: measured, emptying
 *     `no-run-log.fields` to `[]` and deleting `messages.requestOnly` from
 *     `no-conversation-on-record` left this file 17/17 green. The header said
 *     the walk had a divergence half; two of its four rows did not have one.
 *     Closed below by collecting the moved set per damage and requiring it to
 *     be NON-EMPTY, and by driving each row on a run that reaches AS MANY of
 *     its own fields as any run can — but it stays on this list, because the
 *     guard proves a row moved SOMETHING and not that it moved everything the
 *     gap is about. The measured table above is how much SOMETHING is;
 *   • three gaps have no damage at all, because they are conditions of the RUN
 *     rather than of the recording: `cache-transform`, `provider-defaults` and
 *     `forced-tool-schema`. `receipt-conformance.test.ts` drives each of those
 *     on a real run instead.
 *
 * Test types (Convention 3): contract (coverage, resolution, reachability, the
 * per-gap divergence, and the prose rule set) · unit (the two enumerations
 * agree, and the runs really reach the value-conditional fields) · regression
 * (the four fields three review rounds missed, pinned by name, and the two
 * causes the prose used to guess at) · edge (a `ServedView` is frozen all the
 * way down, and a crafted recording whose receipt key holds a non-receipt).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';

import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  LLMCall,
  receiptAt,
  servedAt,
  servedViews,
  RECEIPT_BOUNDARY,
  SERVED_GAPS,
  UNGAPPED_FIELDS,
  type Receipt,
  type ServedGapCause,
  type ServedGapKind,
  type ServedView,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
// The receipt-LESS shape a shipped chart still produces (9.91.0) — the public
// barrel carries this chart's deps type and not the builder itself.
import { buildMessageApiChart } from '../../../src/core/agent/buildMessageApiChart.js';
import {
  codeTokens,
  unprovableGapProse,
  DOC_GAP_PROSE,
  PRINTED_GAP_PROSE,
} from '../../helpers/gapProseClaims';

const SRC = resolve(__dirname, '../../../src/lib/time-travel');
const RECEIPT_FILE = resolve(SRC, 'receipt.ts');
const SERVED_FILE = resolve(SRC, 'servedView.ts');

// ─── (1) the STATIC enumeration — the declarations, expanded ─────────────

interface StaticField {
  /** Dotted path, array indices flattened away: `messages.entries.hash`. */
  readonly path: string;
  /**
   * The leaf's keys are DATA, not declarations — a `Record` or an index
   * signature, so a real run puts `tools.schemaHashes.alpha_tool` under it and
   * no declaration will ever name that.
   *
   * It is one of the two reasons a runtime path can sit below a declared leaf
   * (the other is a foreign type: `messages.asSent[i].role` is an
   * `LLMMessage`'s field, not ours). The truncation rule covers both by
   * stopping at any leaf; this flag is what lets the unit test below prove the
   * Record case is real rather than assumed.
   */
  readonly dynamicKeys: boolean;
}

/** Every `interface` declared in the two files, by name. */
function localInterfaces(): ReadonlyMap<string, ts.InterfaceDeclaration> {
  const out = new Map<string, ts.InterfaceDeclaration>();
  for (const file of [RECEIPT_FILE, SERVED_FILE]) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    sf.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node)) out.set(node.name.text, node);
    });
  }
  return out;
}

/** `readonly X[]` / `X[]` / `readonly X` peeled down to `X`. */
function elementOf(node: ts.TypeNode): ts.TypeNode {
  if (ts.isArrayTypeNode(node)) return elementOf(node.elementType);
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return elementOf(node.type);
  }
  if (ts.isParenthesizedTypeNode(node)) return elementOf(node.type);
  return node;
}

/** `Record<…>` or `Readonly<Record<…>>` — a container whose KEYS are data. */
function isRecordType(node: ts.TypeNode): boolean {
  const inner = elementOf(node);
  if (ts.isTypeLiteralNode(inner)) return inner.members.some(ts.isIndexSignatureDeclaration);
  if (!ts.isTypeReferenceNode(inner)) return false;
  const name = inner.typeName.getText();
  if (name === 'Record') return true;
  if (name === 'Readonly' && inner.typeArguments?.[0] !== undefined) {
    return isRecordType(inner.typeArguments[0]);
  }
  return false;
}

/** The members to descend into, or `undefined` when this type is a leaf. */
function membersOf(
  node: ts.TypeNode,
  locals: ReadonlyMap<string, ts.InterfaceDeclaration>,
): readonly ts.TypeElement[] | undefined {
  const inner = elementOf(node);
  if (ts.isTypeLiteralNode(inner)) {
    return inner.members.some(ts.isIndexSignatureDeclaration) ? undefined : inner.members;
  }
  if (ts.isUnionTypeNode(inner)) {
    // `T | undefined` / `T | null` — descend into the one real shape, if any.
    for (const arm of inner.types) {
      const found = membersOf(arm, locals);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (ts.isTypeReferenceNode(inner)) {
    const declared = locals.get(inner.typeName.getText());
    return declared?.members;
  }
  return undefined;
}

/** Expand one interface to leaf paths, following only local declarations. */
function expand(
  members: readonly ts.TypeElement[],
  locals: ReadonlyMap<string, ts.InterfaceDeclaration>,
  prefix: string,
  seen: ReadonlySet<string>,
  out: StaticField[],
): void {
  for (const member of members) {
    if (!ts.isPropertySignature(member) || member.type === undefined) continue;
    const name = member.name.getText();
    const path = prefix === '' ? name : `${prefix}.${name}`;
    const inner = elementOf(member.type);
    const key = ts.isTypeReferenceNode(inner) ? inner.typeName.getText() : '';
    const nested = seen.has(key) ? undefined : membersOf(member.type, locals);
    if (nested === undefined || nested.length === 0) {
      out.push({ path, dynamicKeys: isRecordType(member.type) });
    } else {
      expand(nested, locals, path, key === '' ? seen : new Set([...seen, key]), out);
    }
  }
}

/** Every leaf path of one declared interface. */
function staticFieldsOf(name: string): readonly StaticField[] {
  const locals = localInterfaces();
  const declared = locals.get(name);
  expect(declared, `${name} is not an interface in receipt.ts or servedView.ts`).toBeDefined();
  const out: StaticField[] = [];
  expand(declared!.members, locals, '', new Set([name]), out);
  return out;
}

// ─── (2) the RUNTIME enumeration — real runs, walked ─────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

/** A provider that answers from a script. */
function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'gap-walk-mock',
    carriesForcedToolChoice: true,
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
      i += 1;
      return {
        content: reply.content,
        toolCalls: reply.toolCalls ?? [],
        usage: { input: 0, output: 0 },
      };
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

/** One real run's receipts and views. */
interface Walked {
  readonly receipts: readonly Receipt[];
  readonly views: readonly ServedView[];
}

/**
 * THE RECEIPT-LESS RUN — one driver, because four tests below need the same
 * shape and it moved once already.
 *
 * It was an `LLMCall` until 9.91.0, where that chart started minting. What is
 * left on a SHIPPED chart is a message-API chart builder handed to an executor
 * the caller owns with no run id supplied: every hash a receipt carries is
 * salted with the run id, so a chart that cannot be given one declines the
 * mint. A consumer's own `call-llm` stage is the other way to get here, and it
 * is not this library's to drive.
 */
async function receiptlessRun(): Promise<unknown> {
  const chart = buildMessageApiChart({
    provider: scripted([answer('done')]) as never,
    model: 'mock',
    systemPrompt: 'you are a probe',
  });
  const executor = new FlowChartExecutor(chart);
  await executor.run({ input: { message: 'the one turn that went out' } });
  return executor.getSnapshot();
}

/**
 * SIX scenarios, chosen to reach the value-conditional fields: the dials and
 * a tool result's join key, a wrap-up that withholds every tool, a forced
 * output tool, the staged-refs request-only line, an `LLMCall` chart, and a
 * chart that mints no receipt at all.
 */
async function realRuns(): Promise<readonly Walked[]> {
  const walked: Walked[] = [];
  const collect = (snapshot: unknown): void => {
    const views = servedViews(snapshot);
    walked.push({
      views,
      receipts: views
        .map((v) => receiptAt(snapshot, v.epoch))
        .filter((r): r is Receipt => r !== undefined),
    });
  };

  // (a) tools, a tool result (the join key), and every sampling dial.
  const dials = Agent.create({
    provider: scripted([call('c1', 'alpha_tool'), answer('done')]) as never,
    model: 'mock',
    maxIterations: 6,
    temperature: 0.25,
    maxTokens: 512,
    thinkingBudget: 1024,
    stop: ['STOP'],
  } as never)
    .system('you are a bot')
    .tool(aTool('alpha_tool'))
    .build();
  await dials.run({ message: 'go' });
  collect(dials.getSnapshot()!);

  // (b) the wrap-up call: the tools come off, and the receipt says why.
  const wrapUp = Agent.create({
    provider: scripted([call('c1', 'alpha_tool'), call('c2', 'alpha_tool')]) as never,
    model: 'mock',
    maxIterations: 2,
  })
    .system('bot')
    .tool(aTool('alpha_tool'))
    .build();
  await wrapUp.run({ message: 'go' });
  collect(wrapUp.getSnapshot()!);

  // (c) a tool-forced output: `tools.forced`, and the schema gap.
  const forced = Agent.create({
    provider: scripted([call('1', 'respond_with_schema')]) as never,
    model: 'mock',
  })
    .system('bot')
    .outputSchema({ safeParse: (v: unknown) => ({ ok: true, value: v }) } as never, {
      strategy: 'tool-forced',
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    })
    .build();
  await forced.run({ message: 'go' });
  collect(forced.getSnapshot()!);

  // (d) the staged-refs nudge: the one request-only line.
  const rows = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ vol: i, gb: 18 })));
  const nudged = Agent.create({
    provider: scripted([call('c1', 'export_rows'), answer('staged')]) as never,
    model: 'mock',
    maxIterations: 6,
    artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2000 } },
  })
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
  await nudged.run({ message: 'stage the rows' });
  collect(nudged.getSnapshot()!);

  // (e) an LLMCall chart: its own executor, its own run id, its own receipt
  // since 9.91.0 — a second chart shape the law runs on.
  const bare = LLMCall.create({ provider: scripted([answer('done')]) as never, model: 'mock' })
    .system('you are a probe')
    .build();
  await bare.run({ message: 'the one turn that went out' });
  collect(bare.getSnapshot()!);

  // (f) a view with NO receipt behind it — the shape a shipped chart still
  // produces: a chart builder on an executor the caller owns, with no run id
  // to salt the hashes with, so it declines the mint rather than shipping
  // unsalted fingerprints.
  collect(await receiptlessRun());

  return walked;
}

/** Leaf paths of a real value, array indices flattened away. */
function runtimePaths(value: unknown, prefix: string, out: Set<string>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) out.add(prefix);
    for (const item of value) runtimePaths(item, prefix, out);
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (prefix !== '') out.add(prefix);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    out.add(prefix);
    return;
  }
  for (const [key, inner] of entries) {
    runtimePaths(inner, prefix === '' ? key : `${prefix}.${key}`, out);
  }
}

// ─── the correspondence ──────────────────────────────────────────────────

/**
 * The three places a `ServedView` spells a `Receipt` field differently. Gap
 * `fields` are always `Receipt` paths (see `ServedGap.fields`), so a view path
 * is translated before it is asked about — and BOTH sides of every row are
 * checked against the real shapes below, so a rename cannot leave the map
 * pointing at a field nobody has.
 */
const VIEW_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  'system.text': ['system.hash', 'system.chars'],
  'messages.asSent': ['messages.entries', 'messages.count'],
  'tools.schemas': ['tools.schemaHashes'],
};

/** `a.b.c` covered by a list naming `a`, `a.b` or `a.b.c` — never `a.bc`. */
const coveredBy = (names: readonly string[], path: string): boolean =>
  names.some((name) => path === name || path.startsWith(`${name}.`));

/** Every field any gap names, deduplicated. */
const GAPPED: readonly string[] = [
  ...new Set(Object.values(SERVED_GAPS).flatMap((g) => [...g.fields])),
];
const UNGAPPED: readonly string[] = Object.keys(UNGAPPED_FIELDS);

/** A view path under the spellings above; a receipt path unchanged. */
function receiptSpellings(path: string): readonly string[] {
  for (const [viewPath, receiptPaths] of Object.entries(VIEW_SPELLINGS)) {
    if (path === viewPath || path.startsWith(`${viewPath}.`)) {
      const tail = path.slice(viewPath.length);
      return receiptPaths.map((p) => `${p}${tail}`);
    }
  }
  return [path];
}

const RECEIPT_FIELDS = staticFieldsOf('Receipt');
const VIEW_FIELDS = staticFieldsOf('ServedView');
const ALL_FIELDS: readonly StaticField[] = [...RECEIPT_FIELDS, ...VIEW_FIELDS];
/** The LEAVES — the fields the catalogue has to account for. */
const ALL_PATHS: readonly string[] = [...new Set(ALL_FIELDS.map((f) => f.path))];
/**
 * Every leaf AND every container above one — `messages`, `messages.entries`,
 * `messages.entries.hash`. A gap may name a container, and an empty container
 * at runtime IS the container rather than a new field, so both questions are
 * asked against this set.
 */
const ALL_NODES: ReadonlySet<string> = new Set(
  ALL_PATHS.flatMap((path) => {
    const parts = path.split('.');
    return parts.map((_p, i) => parts.slice(0, i + 1).join('.'));
  }),
);

/** The walk parses two files and drives five real agents; its budget is
 *  stated, not the default. */
const WALK_BUDGET = { timeout: 60_000 };

// ─── Unit: the enumerations themselves ───────────────────────────────────

describe('the field list is derived, not written down', () => {
  it('the declarations expand to leaf paths, including one no run produces', () => {
    const paths = RECEIPT_FIELDS.map((f) => f.path);
    // A spot check that the expander really descends: three levels, an
    // interface reference, and an optional the shape carries but no chart
    // supplies (receipt.ts says so in its own first law).
    expect(paths).toContain('system.pieces.slot');
    expect(paths).toContain('cache.markersApplied.ttl');
    expect(paths).toContain('params.maxTokens');
    expect(paths).toContain('omittedForAttention.hashes');
    expect(paths).toContain('basis.epoch');
    // And that it STOPS where the shape stops being ours.
    expect(VIEW_FIELDS.map((f) => f.path)).toContain('messages.asSent');
    expect(VIEW_FIELDS.map((f) => f.path).some((p) => p.startsWith('messages.asSent.'))).toBe(
      false,
    );
  });

  it(
    'a Record leaf really does carry data for keys — declared AND observed',
    WALK_BUDGET,
    async () => {
      // The declaration says so…
      const schemaHashes = RECEIPT_FIELDS.find((f) => f.path === 'tools.schemaHashes');
      expect(schemaHashes?.dynamicKeys).toBe(true);
      expect(RECEIPT_FIELDS.find((f) => f.path === 'system.chars')?.dynamicKeys).toBe(false);

      // …and a real run proves it, which is what stops the flag being a fact
      // nobody checks. A tool's name really does become a key no type declares.
      const produced = new Set<string>();
      for (const { receipts } of await realRuns()) {
        for (const receipt of receipts) runtimePaths(receipt, '', produced);
      }
      const keys = [...produced].filter((p) => p.startsWith('tools.schemaHashes.'));
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain('tools.schemaHashes.alpha_tool');
      // …and a scalar leaf never grows children.
      expect([...produced].some((p) => p.startsWith('system.chars.'))).toBe(false);
    },
  );

  it('every path a REAL run produces is one the declarations know about', WALK_BUDGET, async () => {
    const unknown = new Set<string>();
    for (const { receipts, views } of await realRuns()) {
      const produced = new Set<string>();
      for (const receipt of receipts) runtimePaths(receipt, '', produced);
      for (const view of views) runtimePaths(view, '', produced);
      for (const path of produced) {
        // A path BELOW a declared leaf is not a new field: it is the inside of
        // a shape this walk deliberately stopped at — a `Record`'s data keys
        // (`tools.schemaHashes.alpha_tool`) or somebody else's type
        // (`messages.asSent[i].role`, an LLMMessage). Truncate to the leaf.
        if (ALL_PATHS.some((leaf) => path.startsWith(`${leaf}.`))) continue;
        // A container the run happened to leave empty is the container.
        if (!ALL_NODES.has(path)) unknown.add(path);
      }
    }
    // The failure message IS the fix instruction: either the declaration moved
    // and this walk is reading a stale shape, or a value carries a field the
    // type does not declare.
    expect([...unknown].sort()).toEqual([]);
  });

  it('the runs really do reach the value-conditional fields', WALK_BUDGET, async () => {
    const produced = new Set<string>();
    for (const { receipts, views } of await realRuns()) {
      for (const receipt of receipts) runtimePaths(receipt, '', produced);
      for (const view of views) runtimePaths(view, '', produced);
    }
    // Without these the runtime half is a formality: each one exists only on a
    // particular kind of call.
    for (const path of [
      'params.temperature',
      'params.toolChoice.name',
      'messages.entries.key',
      'messages.requestOnly.reason',
      'tools.withheld',
      'tools.forced',
      'basis.runId',
    ]) {
      expect(produced, `no scenario produced ${path}`).toContain(path);
    }
  });
});

// ─── Contract: every field is accounted for ──────────────────────────────

describe('every field of a Receipt and a ServedView is accounted for', () => {
  it('fails on a field no gap names and nobody excused, by name', () => {
    const unaccounted = ALL_PATHS.filter(
      (path) =>
        !coveredBy(UNGAPPED, path) &&
        !receiptSpellings(path).some((spelled) => coveredBy(GAPPED, spelled)),
    );
    // TWO ways to satisfy this, and the failure has to say both:
    //   • name the field in a SERVED_GAPS entry's `fields`, if some recording
    //     cannot prove it — that is what a gap IS;
    //   • add it to UNGAPPED_FIELDS with a one-sentence reason why no fold can
    //     fail to produce it.
    // A third way — deleting the field — is not one, and neither is widening
    // an existing gap's sentence to cover a mechanism it does not describe.
    expect(unaccounted).toEqual([]);
  });

  it('the four fields three review rounds missed are named now', () => {
    // Regression, one per miss. Written as paths rather than as a count,
    // because a count is the thing this file exists to replace.
    for (const path of ['system.chars', 'messages.count', 'tools.withheld', 'epoch']) {
      expect(SERVED_GAPS['no-fold-base'].fields, `no-fold-base is short by ${path}`).toContain(
        path,
      );
    }
    // …and `tools.withheld` is named by a gap rather than excused, because the
    // fold that rebuilds it (`wrapUpAsked`) is a fold like any other.
    expect(coveredBy(UNGAPPED, 'tools.withheld')).toBe(false);
  });

  it('the epoch account is the right way round', () => {
    // The fourth review round's finding, pinned by name. Two epoch numbers
    // exist and they are two RECORDS of one fact, not two spellings of it:
    //   • the VIEW's `epoch` is what the fold produced, and a fold that cannot
    //     read `iteration` numbers the turn by its POSITION — so a missing base
    //     can fabricate it, and `no-fold-base` names it;
    //   • the RECEIPT's `basis.epoch` was minted live and rides in the call's
    //     own bundle, so no missing base touches it. Only a missing receipt
    //     loses it, and `no-receipt-on-chart` names it.
    // Until 9.88.0's fourth round it was exactly backwards, and the fabricable
    // one was excused in UNGAPPED_FIELDS with a reason untrue of servedViews().
    expect(SERVED_GAPS['no-fold-base'].fields).toContain('epoch');
    expect(SERVED_GAPS['no-fold-base'].fields).not.toContain('basis.epoch');
    expect(SERVED_GAPS['no-receipt-on-chart'].fields).toContain('basis.epoch');
    expect(coveredBy(UNGAPPED, 'epoch')).toBe(false);
  });

  it('omittedForAttention is excused, not blamed on the missing receipt', () => {
    // It is absent on EVERY view — no chart in this library supplies it — so a
    // gap that fires on SOME views cannot be what explains it, and on a view
    // that HAS a receipt nothing explained it at all.
    expect(SERVED_GAPS['no-receipt-on-chart'].fields).not.toContain('omittedForAttention');
    expect(UNGAPPED_FIELDS['omittedForAttention']).toBeDefined();
    expect(coveredBy(GAPPED, 'omittedForAttention')).toBe(false);
  });

  it('…and the measurement its comment quotes is re-taken here', WALK_BUDGET, async () => {
    // THE MEASUREMENT MOVED WITH THE MECHANISM (9.88.0, sixth round). It used
    // to sit in the printed reason — "measured on 9.88.0, no chart in this
    // library supplied one" — which named a version and a set of charts, both
    // of them code, in a sentence a renderer prints to somebody who cannot
    // check either. It is now in the COMMENT beside the entry, and this test
    // reads it there.
    //
    // The measurement itself is unchanged and still runs: a dated reading is
    // the honest shape for a fact about the rest of the tree — past tense
    // cannot go false, only stale — and re-taking it every run is what keeps
    // it from going stale unnoticed. If a chart starts supplying one, this
    // fails and the comment gets rewritten with it.
    // Comment markers and line wraps stripped, so the claim is matched as
    // PROSE rather than as whatever shape the formatter left it in.
    const commentProse = readFileSync(SERVED_FILE, 'utf8')
      .replace(/^\s*(?:\/\/|\*)\s?/gm, '')
      .replace(/\s+/g, ' ');
    expect(commentProse).toContain('measured on 9.88.0 no chart in this library ever supplies it');
    const supplied: string[] = [];
    for (const { receipts } of await realRuns()) {
      for (const receipt of receipts) {
        if (receipt.omittedForAttention !== undefined) supplied.push(receipt.basis.provider);
      }
    }
    expect(supplied).toEqual([]);
  });

  it('every excused field carries a reason a person wrote', () => {
    const thin = Object.entries(UNGAPPED_FIELDS).filter(
      ([, reason]) => reason.trim().length < 40 || /\b(todo|tbd|fixme|xxx|n\/a)\b/i.test(reason),
    );
    expect(thin.map(([field]) => field)).toEqual([]);
  });
});

// ─── Contract: the catalogue points at fields that exist ─────────────────

describe('nothing in the catalogue points at a field nobody has', () => {
  it('every SERVED_GAPS field resolves to a real field on one of the two shapes', () => {
    const dangling: string[] = [];
    for (const [kind, gap] of Object.entries(SERVED_GAPS)) {
      for (const field of gap.fields) {
        const hit = ALL_PATHS.some(
          (path) =>
            path === field ||
            path.startsWith(`${field}.`) ||
            receiptSpellings(path).some((s) => s === field || s.startsWith(`${field}.`)),
        );
        if (!hit) dangling.push(`${kind} → ${field}`);
      }
    }
    // A gap pointing at a renamed field is the same rot as a `file:line`
    // pointer: it reads as an answer and is not one.
    expect(dangling).toEqual([]);
  });

  it('every UNGAPPED_FIELDS key resolves to a real field on the view', () => {
    const dangling = UNGAPPED.filter(
      (field) => !ALL_PATHS.some((path) => path === field || path.startsWith(`${field}.`)),
    );
    expect(dangling).toEqual([]);
  });

  it('both sides of every view/receipt spelling row still exist', () => {
    const nodesOf = (fields: readonly StaticField[]): ReadonlySet<string> =>
      new Set(
        fields.flatMap((f) => {
          const parts = f.path.split('.');
          return parts.map((_p, i) => parts.slice(0, i + 1).join('.'));
        }),
      );
    const viewNodes = nodesOf(VIEW_FIELDS);
    const receiptNodes = nodesOf(RECEIPT_FIELDS);
    for (const [viewPath, receiptSides] of Object.entries(VIEW_SPELLINGS)) {
      expect([...viewNodes], `${viewPath} is no longer a ServedView field`).toContain(viewPath);
      for (const side of receiptSides) {
        expect([...receiptNodes], `${side} is no longer a Receipt field`).toContain(side);
      }
    }
  });

  it('a field named by no gap and no excuse would fail — the walk can go red', () => {
    // The guard on the guard. Nothing in this file asserts its own strength,
    // so the check is run against a field that exists on neither shape.
    const invented = 'system.aFieldNobodyDeclared';
    expect(coveredBy(GAPPED, invented)).toBe(false);
    expect(coveredBy(UNGAPPED, invented)).toBe(false);
    expect(ALL_PATHS).not.toContain(invented);
  });
});

// ─── Contract: the prose says only what a gap sentence may say ───────────

/**
 * The vocabulary the CROSS-MODULE row stands down for — every field path of the
 * two shapes, every container above one, and every dotted SEGMENT of one.
 *
 * IT IS VESTIGIAL NOW, and that is the point of it. Under the sixth round's
 * rule a printed sentence names no code at all, not even the fields it covers:
 * it says "the fields below" and the FIELD LIST is a separate value. So the
 * code-shape row refuses every token here anyway, whatever this set says, and
 * the tests below pass it only to keep the older row exercised as the second
 * line of defence.
 *
 * ITS ONE ARGUED EXCEPTION IS GONE. `initialState` sat here through five rounds
 * — the base a recording travels with or without, a key on the RECORD THE
 * READER IS HOLDING rather than a symbol in a module they cannot see, and the
 * argument was good enough to survive every review. It was still a mechanism
 * claim wearing a field's clothes, and the sentence that needed it said the
 * rebuild "could read only what the log itself wrote". That sentence is gone
 * and so is its permission.
 */
const GAP_PROSE_VOCABULARY: ReadonlySet<string> = new Set([
  ...ALL_NODES,
  ...[...ALL_NODES].flatMap((path) => path.split('.')),
]);

describe('every gap sentence says which fields, what they mean, and what to do', () => {
  it('no SERVED_GAPS why names a mechanism — the whole sentence, boundary included', () => {
    // NO STRIP. Through five rounds this test cut `RECEIPT_BOUNDARY` out
    // before judging, because two entries append it verbatim and it is owned
    // in `receipt.ts` — one string should not answer to two rule sets. The
    // sixth round removed the exemption the other way round: the boundary
    // sentence was reduced under the SAME rule as the entries that quote it,
    // so there is one rule set and nothing to cut.
    const bad: string[] = [];
    for (const [kind, gap] of Object.entries(SERVED_GAPS)) {
      bad.push(
        ...unprovableGapProse(
          gap.why,
          PRINTED_GAP_PROSE(`SERVED_GAPS['${kind}'].why`),
          GAP_PROSE_VOCABULARY,
        ),
      );
    }
    // The failure message IS the fix instruction: it names the entry, the words
    // that tripped, and how an edit somewhere else falsifies them.
    expect(bad).toEqual([]);
  });

  it('the boundary sentence obeys the printed rule on its own', () => {
    // Asserted separately as well as inside the two entries that quote it,
    // because `receipt.ts` owns it and a future edit there would otherwise be
    // judged only through whoever happens to append it.
    expect(
      unprovableGapProse(RECEIPT_BOUNDARY, PRINTED_GAP_PROSE('RECEIPT_BOUNDARY'), new Set()),
    ).toEqual([]);
  });

  it('no UNGAPPED_FIELDS reason has one either', () => {
    const bad: string[] = [];
    for (const [field, reason] of Object.entries(UNGAPPED_FIELDS)) {
      bad.push(
        ...unprovableGapProse(
          reason,
          PRINTED_GAP_PROSE(`UNGAPPED_FIELDS['${field}']`),
          GAP_PROSE_VOCABULARY,
        ),
      );
    }
    expect(bad).toEqual([]);
  });

  it('an entry that ends at the boundary quotes it, and never paraphrases it', () => {
    // ONE OWNER for the sentence. An entry that wants to say where the record
    // stops carries the constant byte for byte; one that writes its own version
    // has forked a sentence that is edited in another file.
    const paraphrasing = Object.entries(SERVED_GAPS).filter(
      ([, gap]) => /last saw it/.test(gap.why) && !gap.why.includes(RECEIPT_BOUNDARY),
    );
    expect(paraphrasing.map(([kind]) => kind)).toEqual([]);
    // …and the quote sits at the END, so stripping it cannot remove anything
    // this file wrote.
    for (const [kind, gap] of Object.entries(SERVED_GAPS)) {
      if (!gap.why.includes(RECEIPT_BOUNDARY)) continue;
      expect(gap.why.endsWith(RECEIPT_BOUNDARY), `${kind} buries the boundary mid-sentence`).toBe(
        true,
      );
    }
  });

  it('the rule set refuses the first sentence this release deleted', () => {
    // Nothing above asserts its own strength, so the rules are run against the
    // wording that actually shipped. Five of the six rows fire on it: it counts
    // the causes, it rules them benign, it names modules, it is full of
    // code-shaped tokens, and it mints.
    const shipped =
      'This epoch minted no receipt, so nothing checks the rebuilt view. THREE causes and ' +
      "none of them is a hole in this view: the chart's LLM stage does not mint one (LLMCall " +
      'and the two message-API charts run a call-llm stage of their own), the run declined it ' +
      '(Agent.create({ recordReceipt: false })), or the recording predates 9.88.0.';
    const hits = unprovableGapProse(
      shipped,
      PRINTED_GAP_PROSE('the sentence 9.88.0 deleted'),
      GAP_PROSE_VOCABULARY,
    ).join('\n');
    for (const row of ['cardinality', 'benignity', 'cross-module', 'code-shaped', 'mechanism verb'])
      expect(hits, `${row} did not fire`).toContain(row);
  });

  it('the rule set refuses the MECHANISM sentences the fifth round wrote, which passed it', () => {
    // THE ROUND THAT DECIDED THIS ONE. These shipped in 9.88.0 and passed every
    // row the fifth round had: no cause count, no benignity verdict, no
    // discrimination claim, and every symbol on the allowlist. The reduction
    // rows are what refuse them now, and this test is the only place their
    // wording still exists.
    const refusedNow = [
      'This recording travelled without a fold base (initialState), so the rebuild could read ' +
        'only what the log itself wrote.',
      'The request-only lines are recomposed from the conversation, so they are unproved with it.',
      "Under a 'tool-forced' output strategy the answer tool's schema body was never committed.",
    ];
    for (const sentence of refusedNow) {
      expect(
        unprovableGapProse(
          sentence,
          PRINTED_GAP_PROSE('a fifth-round sentence'),
          GAP_PROSE_VOCABULARY,
        ),
        sentence,
      ).not.toEqual([]);
    }
    // …and each one passes on a DOC, where naming the mechanism is the job.
    for (const sentence of refusedNow) {
      expect(
        unprovableGapProse(sentence, DOC_GAP_PROSE('the same sentence in a doc'), new Set()),
        sentence,
      ).toEqual([]);
    }
  });

  it('THE BLIND SPOT, pinned: a plain-English mechanism claim still walks through', () => {
    // The honest limit of a shape test, asserted rather than promised. This
    // sentence shipped in 9.88.0 and was FALSE the day it shipped — three of
    // the fields it covers (`cache.transform`, `cache.transformHash`,
    // `cache.markersApplied`) are OUTPUTS of the strategy and are on the
    // record. It names no module, no key, no version, no call and no banned
    // verb: "a cache strategy" is two ordinary English words, and no shape row
    // can tell that noun phrase from any other.
    //
    // A PERSON caught it, by reading the sentence against the fields. Nothing
    // here would have. The rows are what stop the sentence being written; they
    // are not what makes it true, and this test exists so the next reader of
    // this file cannot mistake one for the other.
    const passedAndWasFalse =
      'What a cache strategy returned could not be established: only its INPUTS are on the record.';
    expect(
      unprovableGapProse(
        passedAndWasFalse,
        PRINTED_GAP_PROSE('the blind spot'),
        GAP_PROSE_VOCABULARY,
      ),
    ).toEqual([]);
    // What DID kill it is that the catalogue no longer contains it.
    for (const gap of Object.values(SERVED_GAPS)) expect(gap.why).not.toContain('only its INPUTS');
  });

  it('a reduced sentence passes, so the rows are not simply refusing everything', () => {
    expect(
      unprovableGapProse(
        'Nothing on this view has been checked against what went out. The fields below are ' +
          'carried only by a receipt, so their absence here is a gap in the record, never a ' +
          'call made without them.',
        PRINTED_GAP_PROSE('the sentence 9.88.0 wrote instead'),
        new Set(),
      ),
    ).toEqual([]);
  });

  it('the vocabulary is field paths and nothing else — no pardon survives', () => {
    // Every entry has to be a token the shape test would flag, or it is a
    // permission for nothing sitting there looking like an argument. The list
    // of non-field entries is now EMPTY: `initialState` was the last one and
    // the sentence that needed it is gone.
    const notTokens = [...GAP_PROSE_VOCABULARY].filter(
      (word) => codeTokens(word).join('') !== word,
    );
    const fields = new Set([...ALL_NODES, ...[...ALL_NODES].flatMap((p) => p.split('.'))]);
    expect([...GAP_PROSE_VOCABULARY].filter((w) => !fields.has(w))).toEqual([]);
    // A plain word like `epoch` is in the vocabulary and is not code-shaped at
    // all; what matters is that nothing code-shaped is pardoned by accident.
    expect(notTokens.every((word) => !word.includes('.'))).toBe(true);
  });

  it('no printed sentence names a field path, which is what "the fields below" replaced', () => {
    // The reduction restated as an assertion about the OUTPUT rather than about
    // the rows: a sentence that still pointed at `cache.transform` or `asSent`
    // would be doing the field list's job in prose, and the field list is a
    // value the renderer already has.
    const printed = [
      ...Object.values(SERVED_GAPS).map((gap) => gap.why),
      ...Object.values(UNGAPPED_FIELDS),
    ];
    for (const sentence of printed) expect(codeTokens(sentence), sentence).toEqual([]);
  });
});

// ─── Contract: no orphan kind, no unreachable entry ──────────────────────

/**
 * The gap kinds `viewOf` can actually push, read out of `servedView.ts`'s own
 * source with the compiler's parser.
 *
 * A source read, because reachability is not a runtime question a test can ask
 * without driving every recording shape that exists. Its blind spot — a kind
 * pushed through a variable — is closed by the second assertion below rather
 * than left in the header as a caveat.
 */
function pushedKinds(): { readonly literals: readonly string[]; readonly computed: number } {
  const text = readFileSync(SERVED_FILE, 'utf8');
  const sf = ts.createSourceFile(SERVED_FILE, text, ts.ScriptTarget.Latest, true);
  const literals = new Set<string>();
  let computed = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'gapOf'
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteral(arg)) literals.add(arg.text);
      else computed += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { literals: [...literals].sort(), computed };
}

describe('the catalogue and the code that raises it are the same set', () => {
  it('every kind the rebuild can push is in the catalogue, and every entry is reachable', () => {
    const { literals } = pushedKinds();
    const catalogued = (Object.keys(SERVED_GAPS) as ServedGapKind[]).sort();
    // Both directions in one comparison: an orphan kind is on the left and
    // missing on the right, an unreachable entry is the other way round.
    expect(literals).toEqual(catalogued);
  });

  it('no gapOf call hides a kind behind a variable', () => {
    // The technique above can only see string literals. This is what stops
    // that from being a hole somebody widens by accident.
    expect(pushedKinds().computed).toBe(0);
  });

  it('the new kind fires on the chart it was written for', WALK_BUDGET, async () => {
    const snapshot = await receiptlessRun();
    const view = servedAt(snapshot, 1)!;

    // The chart mints no receipt — declared, not left as a silent `undefined`.
    expect(receiptAt(snapshot, 1)).toBeUndefined();
    expect(view.basis).toBeUndefined();
    expect(view.gaps.map((g) => g.gap)).toContain('no-receipt-on-chart');
    // …and the rebuild it does not affect is still standing.
    expect(view.system.text).toBe('you are a probe');
    expect(view.messages.asSent).toHaveLength(1);
    // `provider-defaults` is the OTHER half of the same pair: the caveat when
    // a receipt recorded the dials. Never both.
    expect(view.gaps.map((g) => g.gap)).not.toContain('provider-defaults');
  });
});

// ─── Contract: the cause is a value, one test per value ──────────────────
//
// WHY THIS BLOCK EXISTS. The gap's own sentence used to end with the causes
// that produce it, and a cause added later — a value under the receipt key that
// the read refuses because it carries no basis — made that sentence false with
// nobody editing it. The fix is not a better sentence. It is that the site
// which KNOWS reports what it found, and the sentence stops guessing.
//
// So each value gets a test, driven on a real run where a real run produces it
// and on a crafted recording where none can.

/**
 * One test per cause, and the compiler is what says so: a value added to
 * `ServedGapCause` and not listed here fails to typecheck (`npm run lint`,
 * `npm run test:types` — the root `tsconfig.json` excludes `test/`, so this
 * table is documentation to `vitest` and a check to those two).
 */
const CAUSE_DRIVEN: Readonly<Record<ServedGapCause, string>> = {
  'no-receipt-committed':
    'a message-API chart run with no run id, which serves a model and mints nothing',
  'receipt-shape-rejected': 'a crafted recording whose receipt key holds a value with no basis',
};

describe('the cause of a missing receipt is a value the read computed', () => {
  it('every cause the type names is driven by a test below', () => {
    expect(Object.keys(CAUSE_DRIVEN).sort()).toEqual([
      'no-receipt-committed',
      'receipt-shape-rejected',
    ]);
  });

  it('a real run that mints none reports no-receipt-committed', WALK_BUDGET, async () => {
    const snapshot = await receiptlessRun();

    const gap = servedAt(snapshot, 1)!.gaps.find((g) => g.gap === 'no-receipt-on-chart');
    expect(gap?.cause).toBe('no-receipt-committed');
    expect(receiptAt(snapshot, 1)).toBeUndefined();
  });

  it(
    'a receipt key holding a non-receipt reports receipt-shape-rejected',
    WALK_BUDGET,
    async () => {
      // The value is a plausible half-receipt — everything but the basis — which
      // is what a truncated write or a hand-edit leaves behind. The read refuses
      // it rather than hand back a shape a caller would read `.basis.runId` off,
      // and THAT refusal is the cause that means the recording is damaged.
      const intact = await plainRun(false);
      const damaged = rewriteKey(intact, 'receipt', {
        system: { hash: 'deadbeefdeadbeef', chars: 11, pieces: [] },
      });

      const views = servedViews(damaged);
      expect(views.length).toBeGreaterThan(0);
      for (const view of views) {
        const gap = view.gaps.find((g) => g.gap === 'no-receipt-on-chart');
        expect(gap?.cause).toBe('receipt-shape-rejected');
        expect(view.basis).toBeUndefined();
        // …and the rebuild the missing receipt does not touch is still standing,
        // which is what the gap's sentence says and what makes it worth saying.
        expect(view.system.text).toBe('you are a bot');
      }
      expect(receiptAt(damaged, 1)).toBeUndefined();
      // The INTACT run is the control: same code path, a receipt, no gap.
      expect(servedAt(intact, 1)!.gaps.map((g) => g.gap)).not.toContain('no-receipt-on-chart');
    },
  );

  it('the two causes are told apart by the read and not by the sentence', WALK_BUDGET, async () => {
    // The point of the release, stated as a comparison: two recordings, the
    // SAME printed sentence, two different values. A sentence cannot do that,
    // which is why it stopped trying.
    const missing = servedAt(await receiptlessRun(), 1)!.gaps.find(
      (g) => g.gap === 'no-receipt-on-chart',
    )!;
    const rejected = servedViews(
      rewriteKey(await plainRun(false), 'receipt', { system: { hash: 'x', chars: 1, pieces: [] } }),
    )[0]!.gaps.find((g) => g.gap === 'no-receipt-on-chart')!;

    expect(missing.why).toBe(rejected.why);
    expect(missing.cause).not.toBe(rejected.cause);
  });

  it('no other gap invents a cause, and this one always carries it', WALK_BUDGET, async () => {
    const withCause: string[] = [];
    const withoutCause: string[] = [];
    for (const { views } of await realRuns()) {
      for (const view of views) {
        for (const gap of view.gaps) {
          if (gap.cause !== undefined) withCause.push(gap.gap);
          else if (gap.gap === 'no-receipt-on-chart') withoutCause.push(gap.gap);
        }
      }
    }
    // A gap carries a cause when the site that raised it read something that
    // told it. Anywhere else a cause would be the enumeration coming back as a
    // field — a value invented to fill a slot.
    expect([...new Set(withCause)]).toEqual(['no-receipt-on-chart']);
    expect(withoutCause).toEqual([]);
  });
});

// ─── Contract: a ServedView is a value, all of it ────────────────────────

describe('a ServedView is a value', () => {
  it('every container on it is frozen, not two of six', WALK_BUDGET, async () => {
    const agent = Agent.create({
      provider: scripted([call('c1', 'alpha_tool'), answer('done')]) as never,
      model: 'mock',
      maxIterations: 6,
    })
      .system('you are a bot')
      .tool(aTool('alpha_tool'))
      .build();
    await agent.run({ message: 'go' });
    const view = servedAt(agent.getSnapshot()!, 2)!;

    for (const container of [
      view,
      view.system,
      view.system.pieces,
      view.messages,
      view.messages.asSent,
      view.messages.requestOnly,
      view.tools,
      view.tools.names,
      view.tools.schemas,
      view.gaps,
    ]) {
      expect(Object.isFrozen(container)).toBe(true);
    }
    expect(Object.isFrozen(view.basis)).toBe(true);
    for (const piece of view.system.pieces) expect(Object.isFrozen(piece)).toBe(true);
    for (const gap of view.gaps) expect(Object.isFrozen(gap)).toBe(true);
    // And it really refuses: a frozen target throws in strict mode, which a
    // module always is.
    expect(() => {
      (view as { epoch: number }).epoch = 99;
    }).toThrow();
  });
});

// ─── Contract: the DIVERGENCE half — a gap names what it actually costs ──
//
// WHY THIS HALF EXISTS, and it is the part worth reading. The coverage check
// above asks "is this field named by SOME gap?", and that question is too weak
// to have caught the defect this file was written for. `system.chars` and
// `messages.count` were missing from `no-fold-base` while `cache-transform`
// named them both, so the field was accounted for and the account was wrong:
// the gap that describes the MECHANISM did not name the fields the mechanism
// breaks. Nothing static can tell those apart.
//
// So this half MEASURES it. Take a real recording, damage it the way each gap
// describes, rebuild, and diff the view field by field against the intact one.
// Every field that MOVED must be named by the gap that damage raises. The list
// stops being a reading of the code and becomes a reading of the behaviour.
//
// One direction only: named ⊇ changed. A gap may name more than it changes —
// `cache-transform` names the composition as a CAVEAT and changes nothing,
// `no-receipt-on-chart` names receipt-only fields that never appear on a view
// — and demanding equality would delete exactly those honest entries.
//
// Three gaps have no damage to apply, because they are conditions of the RUN
// and not of the recording: `cache-transform` (a strategy rewrote the request),
// `provider-defaults` (a receipt exists) and `forced-tool-schema` (a
// 'tool-forced' output). `receipt-conformance.test.ts` drives each of those on
// a real run instead, which is the honest place for them.

/** A detached copy with one state key gone from every log and every base. */
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

/**
 * A detached copy with one state key REWRITTEN wherever the log wrote it.
 *
 * The other half of `stripKey`, and the crafted damage the second cause needs:
 * no run produces a recording whose receipt key holds a non-receipt, because
 * the mint either runs or does not. A truncated file, a hand-edited log or a
 * consumer that wrote its own value under the key does — and that is the case
 * the read refuses, so it is the case a test has to construct.
 */
function rewriteKey<T>(recording: T, key: string, value: unknown): T {
  type Bundle = { trace: { path: string }[]; overwrite: Record<string, unknown> };
  type Log = { commitLog?: Bundle[]; history?: Bundle[]; initialState?: Record<string, unknown> };
  const copy = JSON.parse(JSON.stringify(recording)) as T & {
    subflowResults?: Record<string, { treeContext?: Log }>;
  };
  const rewrite = (log: Log | undefined): void => {
    if (!log) return;
    for (const bundle of [...(log.commitLog ?? []), ...(log.history ?? [])]) {
      if (bundle.trace.some((t) => t.path === key)) bundle.overwrite[key] = value;
    }
    if (log.initialState && key in log.initialState) log.initialState[key] = value;
  };
  rewrite(copy as Log);
  for (const entry of Object.values(copy.subflowResults ?? {})) rewrite(entry?.treeContext);
  return copy;
}

/** A detached copy with every fold base gone — `getSnapshot({ redact: true })`
 *  hands back this shape, and so does any recording that travelled without it. */
function stripBases<T>(recording: T): T {
  type Log = { initialState?: unknown };
  const copy = JSON.parse(JSON.stringify(recording)) as T & {
    subflowResults?: Record<string, { treeContext?: Log }>;
  };
  delete (copy as Log).initialState;
  for (const entry of Object.values(copy.subflowResults ?? {})) {
    if (entry?.treeContext) delete entry.treeContext.initialState;
  }
  return copy;
}

/** The values at one dotted path, arrays flattened, `undefined` dropped. */
function valuesAt(root: unknown, path: string): readonly unknown[] {
  let cursor: unknown[] = [root];
  for (const key of path.split('.')) {
    const next: unknown[] = [];
    for (const item of cursor) {
      const holders = Array.isArray(item) ? item : [item];
      for (const holder of holders) {
        if (holder === null || typeof holder !== 'object') continue;
        const value = (holder as Record<string, unknown>)[key];
        if (value !== undefined) next.push(value);
      }
    }
    cursor = next;
  }
  return cursor;
}

/** Every leaf path of a `ServedView`, minus the account itself. */
const VIEW_PATHS: readonly string[] = VIEW_FIELDS.map((f) => f.path).filter(
  (p) => p !== 'gaps' && !p.startsWith('gaps.'),
);

interface Damage {
  readonly gap: ServedGapKind;
  /** What is done to the recording, in the words the gap's own `why` uses. */
  readonly what: string;
  /** The run to damage. It has to be one the damage can REACH — see
   *  {@link resumedRun}. */
  readonly run: () => Promise<unknown>;
  readonly apply: (recording: unknown) => unknown;
}

const DAMAGES: readonly Damage[] = [
  {
    gap: 'no-fold-base',
    what: 'the recording travelled without RuntimeSnapshot.initialState',
    // A RESUMED run, and this choice is the whole row. On a run that never
    // paused, deleting `initialState` changes nothing measurable: every value
    // the rebuild reads was `set` in the log itself, so the damaged view is
    // byte-identical and the row would pass while proving nothing (measured —
    // 13 system chars and the same tool list, both before and after, in both
    // chart shapes). A resume is a fresh executor seeded from
    // `checkpoint.sharedState`, so the pre-pause world lives in the BASE and
    // nowhere else, which is what the gap's own sentence says.
    run: () => resumedRun(),
    apply: stripBases,
  },
  {
    gap: 'no-run-log',
    // A NUDGED run, and like the row above that choice is the whole row. The
    // fields this gap names are all run CONSTANTS or composed from one, and a
    // two-turn agent with a plain tool has none of them: measured, emptying
    // `commitLog` on `plainRun(true)` left every view byte-identical, so the
    // row passed while proving nothing — with `no-run-log.fields` emptied to
    // `[]` it still passed. The staged-refs nudge is composed from
    // `toolWantsByName`, which lives in the run log and only there, so on this
    // run the damage really costs a request-only line.
    what: 'a subflow subtree handed in on its own, with no RUN log',
    run: () => nudgedRun(true),
    apply: (r) => {
      const copy = JSON.parse(JSON.stringify(r)) as { commitLog: unknown[] };
      copy.commitLog = [];
      return copy;
    },
  },
  {
    gap: 'no-conversation-on-record',
    // NUDGED too, for the second half of the same gap. Stripping the
    // conversation off a plain run moves `messages.asSent` and stops there;
    // `messages.requestOnly` — which this gap names because the nudge is
    // recomposed FROM the conversation — was never reached, and deleting it
    // from the gap's field list left the row green. A run that really composes
    // a nudge is what makes that entry a measured claim.
    what: 'neither history nor messagesInjections was committed',
    run: () => nudgedRun(false),
    apply: (r) => stripKey(stripKey(r, 'history'), 'messagesInjections'),
  },
  {
    gap: 'no-receipt-on-chart',
    what: 'no receipt was minted at the call',
    run: () => plainRun(false),
    apply: (r) => stripKey(r, 'receipt'),
  },
];

/** A two-turn agent run, in whichever chart shape the damage needs. */
async function plainRun(grouped: boolean): Promise<unknown> {
  const agent = Agent.create({
    provider: scripted([call('c1', 'alpha_tool'), answer('done')]) as never,
    model: 'mock',
    maxIterations: 6,
    temperature: 0.25,
    ...(grouped && { reactMode: 'dynamic-grouped' as const }),
  })
    .system('you are a bot')
    .tool(aTool('alpha_tool'))
    .build();
  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

/**
 * A run that composes a STAGED-REFS NUDGE — the one request-only line the
 * library writes, and the only shape where two of the four damages below cost
 * anything at all.
 *
 * The nudge is a pure function of three committed facts: the conversation, the
 * tools served this call, and the `wants` declarations `seed` put in the RUN
 * log. So removing the run log costs it, and so does removing the
 * conversation — which is exactly what `no-run-log` and
 * `no-conversation-on-record` claim about `messages.requestOnly`, and neither
 * claim was measured until this run existed.
 */
async function nudgedRun(grouped: boolean): Promise<unknown> {
  const rows = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ vol: i, gb: 18 })));
  const agent = Agent.create({
    provider: scripted([call('c1', 'export_rows'), answer('staged')]) as never,
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
  const snapshot = agent.getSnapshot()!;
  // The row is only worth running if the nudge really composed — otherwise the
  // damage below has nothing to take away and we are back to a vacuous row.
  expect(
    servedViews(snapshot).some((v) => v.messages.requestOnly.length > 0),
    'the nudged run composed no request-only line',
  ).toBe(true);
  return snapshot;
}

/**
 * A run that PAUSED and RESUMED — the only shape where a fold base carries
 * anything, and therefore the only shape where removing it is damage.
 *
 * The resumed snapshot holds one epoch: the turn after the pause. Everything
 * that turn read — the system prompt, the whole window, the tool list — was
 * written by the run BEFORE the pause and reaches the resumed executor as
 * `checkpoint.sharedState`, i.e. as the fold base.
 */
async function resumedRun(): Promise<unknown> {
  const agent = Agent.create({
    provider: scripted([call('c1', 'ask_human'), answer('done')]) as never,
    model: 'mock',
  })
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
  return agent.getSnapshot()!;
}

describe('each gap names the fields its own damage actually moves', () => {
  it(
    'fails on a field a damaged rebuild changed and the gap does not name',
    WALK_BUDGET,
    async () => {
      const unnamed: string[] = [];
      const vacuous: string[] = [];
      for (const damage of DAMAGES) {
        const intact = await damage.run();
        const broken = damage.apply(intact);
        const before = servedViews(intact);
        const after = servedViews(broken);
        // The damage has to REACH the rebuild, or the row proves nothing.
        expect(after.length, `${damage.gap}: nothing to compare`).toBeGreaterThan(0);
        expect(
          after.every((v) => v.gaps.some((g) => g.gap === damage.gap)),
          `${damage.gap} did not fire on: ${damage.what}`,
        ).toBe(true);

        const named = SERVED_GAPS[damage.gap].fields;
        // THE GUARD ON THE GUARD, for every row rather than for one.
        //
        // The check below asks "is every field that MOVED named?" and that
        // question is trivially satisfied by a damage that moves nothing. Two
        // of these four rows were in exactly that position for a release: on a
        // plain two-turn agent, emptying the run log and stripping the
        // conversation left `messages.requestOnly` untouched, so
        // `no-run-log.fields` could be emptied to `[]` and `messages.requestOnly`
        // deleted from `no-conversation-on-record` with this file still 17/17
        // green. Collecting what each damage moves and REQUIRING it to be
        // non-empty is what turns a passing row into a measurement.
        const moved = new Set<string>();
        for (const [i, view] of after.entries()) {
          const original = before[i];
          if (original === undefined) continue;
          for (const path of VIEW_PATHS) {
            const was = JSON.stringify(valuesAt(original, path));
            const now = JSON.stringify(valuesAt(view, path));
            if (was === now) continue;
            moved.add(path);
            // EVERY spelling, not any. A view field that maps to two receipt
            // fields moves both — a different system string has a different hash
            // AND a different length — and `some` is precisely what let
            // `no-fold-base` name `system.hash` while going short by
            // `system.chars` for three review rounds. Verified by reverting the
            // fix: with `some` this row stayed green, with `every` it goes red
            // naming the field.
            const missing = receiptSpellings(path).filter((spelled) => !coveredBy(named, spelled));
            for (const field of missing) {
              unnamed.push(`${damage.gap} moves ${path} (${field}) and does not name it`);
            }
          }
        }
        if (moved.size === 0) {
          vacuous.push(
            `${damage.gap}: the damage (${damage.what}) moved no field on this run, so the ` +
              "row proves nothing — drive it on a run that reaches the gap's own fields, or " +
              "say in the gap's `why` why no run can",
          );
        }
      }
      // A row that damages nothing fails FIRST, because a green row that
      // measured nothing is worse than a red one: it reads as evidence.
      expect(vacuous.sort()).toEqual([]);
      // The failure message IS the fix instruction: add the field to that gap's
      // `fields`, or explain in the gap's `why` why the move is not a loss.
      expect([...new Set(unnamed)].sort()).toEqual([]);
    },
  );

  it(
    'how much of each gap its own damage reaches — the number, not the adjective',
    WALK_BUDGET,
    async () => {
      // THE MEASUREMENT THE HEADER STATES. The row above proves each damage
      // moves SOMETHING; this one says how much, per row, so the header's table
      // is a reading of the behaviour rather than a sentence somebody wrote
      // once. A previous header claimed the vacuous-row guard was closed "by
      // driving each row on a run that reaches its own fields" — measured, no
      // run reaches all of any row's fields but one, and three of the four
      // reach a minority. A field this half does not reach is carried by the
      // coverage check above and by `receipt-conformance.test.ts`.
      const measured: Record<string, string> = {};
      for (const damage of DAMAGES) {
        const intact = await damage.run();
        const before = servedViews(intact);
        const after = servedViews(damage.apply(intact));
        const moved = new Set<string>();
        for (const [i, view] of after.entries()) {
          const original = before[i];
          if (original === undefined) continue;
          for (const path of VIEW_PATHS) {
            if (JSON.stringify(valuesAt(original, path)) === JSON.stringify(valuesAt(view, path))) {
              continue;
            }
            for (const spelled of receiptSpellings(path)) moved.add(spelled);
          }
        }
        const named = SERVED_GAPS[damage.gap].fields;
        const reached = named.filter((field) =>
          [...moved].some((m) => m === field || m.startsWith(`${field}.`)),
        );
        measured[damage.gap] = `${reached.length} of ${named.length}`;
      }
      // Verbatim what the header's table says. A change to a field list or a
      // damage moves a number here, and the failure prints the pair to copy.
      expect(measured).toEqual({
        'no-fold-base': '7 of 11',
        'no-conversation-on-record': '3 of 3',
        'no-receipt-on-chart': '3 of 8',
        'no-run-log': '1 of 4',
      });
    },
  );

  it(
    'the damage really is damage — a base-less rebuild is measurably short',
    WALK_BUDGET,
    async () => {
      // The row above now refuses a damage that moves nothing, for every row.
      // This one stays because it pins the MEASUREMENT that rule came from: on
      // a non-resumed run, deleting `initialState` leaves the view
      // byte-identical, and the two counts below are the two the catalogue was
      // short by for three review rounds. A generic rule and a named
      // reproduction are different evidence.
      const intact = await resumedRun();
      const broken = stripBases(intact);
      const before = servedViews(intact)[0]!;
      const after = servedViews(broken)[0]!;
      // The reproduction the third review round reported, re-measured here: a
      // real prompt and a real window become a shorter prompt and a shorter one.
      expect(before.system.text).toContain('SYSTEM_MARKER');
      expect(after.system.text.length).toBeLessThan(before.system.text.length);
      expect(after.messages.asSent.length).toBeLessThan(before.messages.asSent.length);
      // …and the two COUNTS that move with them are the two the catalogue was
      // short by for three review rounds.
      expect(SERVED_GAPS['no-fold-base'].fields).toContain('system.chars');
      expect(SERVED_GAPS['no-fold-base'].fields).toContain('messages.count');
    },
  );
});

// ─── Contract: the prose copies restate the constant, they do not retype it ──

/**
 * The two hand-written gap tables.
 *
 * WHY THEY ARE PARSED. Both restate `SERVED_GAPS` for a reader who is not in
 * the source, and both were wrong on the day the feature was written: the
 * README named three fields for `no-run-log` where the constant names four, and
 * described `cache-transform` as covering `tools.*` when it covers two of the
 * four fields under `tools`. Short in one row and over-broad in another, in a
 * table nobody could check — the exact failure mode the walk above exists to
 * end, one layer out.
 *
 * So the field lists in both documents are now LITERAL — the same dotted paths
 * the constant holds, in backticks — and this test reads them back. Prose stays
 * prose and is not checked; what is checked is the list a reader would copy.
 */
const DOC_TABLES: readonly {
  readonly file: string;
  readonly parse: (text: string) => ReadonlyMap<string, readonly string[]>;
  /** The row's PROSE, so the same rule set that judges the constant judges the
   *  copies. One row weaker there — `gapProseClaims.ts` says which and why. */
  readonly parseWhy: (text: string) => ReadonlyMap<string, string>;
}[] = [
  {
    file: resolve(__dirname, '../../../src/lib/time-travel/README.md'),
    // A markdown table: `| \`kind\` | \`a\`, \`b\` | why… |`. Cells are split on
    // the pipe and only the first two are read, so a `|` inside the prose
    // cannot move the two that matter.
    parse: (text) => {
      const out = new Map<string, readonly string[]>();
      const start = text.indexOf('| gap | fields | why |');
      expect(start, 'the README gap table header moved').toBeGreaterThan(-1);
      const block = text.slice(start).split('\n\n')[0]!;
      for (const line of block.split('\n')) {
        const cells = line.split('|');
        const kind = /`([a-z-]+)`/.exec(cells[1] ?? '')?.[1];
        if (kind === undefined) continue;
        out.set(
          kind,
          [...(cells[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
        );
      }
      return out;
    },
    // The third cell of the same row, joined back up so a `|` inside the prose
    // cannot truncate it.
    parseWhy: (text) => {
      const out = new Map<string, string>();
      const start = text.indexOf('| gap | fields | why |');
      expect(start, 'the README gap table header moved').toBeGreaterThan(-1);
      const block = text.slice(start).split('\n\n')[0]!;
      for (const line of block.split('\n')) {
        const cells = line.split('|');
        const kind = /`([a-z-]+)`/.exec(cells[1] ?? '')?.[1];
        if (kind === undefined) continue;
        // Cell three onward, joined back up: a `|` inside the prose splits the
        // cell and would truncate the sentence this rule set has to judge.
        out.set(kind, cells.slice(3, -1).join('|').trim());
      }
      return out;
    },
  },
  {
    file: resolve(__dirname, '../../../docs-next/content/docs/debug/time-travel.mdx'),
    // A bullet list: `- **\`kind\`** → fields: \`a\`, \`b\``, one line, with the
    // prose on the lines under it.
    parse: (text) => {
      const out = new Map<string, readonly string[]>();
      for (const match of text.matchAll(/^- \*\*`([a-z-]+)`\*\* → fields: (.+)$/gm)) {
        out.set(
          match[1]!,
          [...match[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
        );
      }
      return out;
    },
    // The indented lines under each bullet, up to the next one.
    parseWhy: (text) => {
      const out = new Map<string, string>();
      let kind: string | undefined;
      let buffer: string[] = [];
      const flush = (): void => {
        if (kind !== undefined) out.set(kind, buffer.join(' ').trim());
        kind = undefined;
        buffer = [];
      };
      for (const line of text.split('\n')) {
        const head = /^- \*\*`([a-z-]+)`\*\* → fields: /.exec(line);
        if (head !== null) {
          flush();
          kind = head[1]!;
          continue;
        }
        if (kind === undefined) continue;
        if (/^\s+\S/.test(line)) buffer.push(line.trim());
        else flush();
      }
      flush();
      return out;
    },
  },
];

describe('the gap tables in the docs are the catalogue, not a copy of it', () => {
  for (const { file, parse, parseWhy } of DOC_TABLES) {
    const name = file.split('/').slice(-2).join('/');

    it(`${name} lists every gap kind and no invented one`, () => {
      const doc = parse(readFileSync(file, 'utf8'));
      expect([...doc.keys()].sort()).toEqual(Object.keys(SERVED_GAPS).sort());
    });

    it(`${name} names exactly the fields each gap names`, () => {
      const doc = parse(readFileSync(file, 'utf8'));
      const wrong: string[] = [];
      for (const [kind, gap] of Object.entries(SERVED_GAPS)) {
        const listed = [...(doc.get(kind) ?? [])].sort();
        const actual = [...gap.fields].sort();
        // SORTED, not in declaration order: what a reader needs from the table
        // is the SET, and pinning the order would fail on a reordering that
        // costs nobody anything. Short and over-broad both fail here.
        if (JSON.stringify(listed) !== JSON.stringify(actual)) {
          wrong.push(
            `${kind}: doc has [${listed.join(', ')}], SERVED_GAPS has [${actual.join(', ')}]`,
          );
        }
      }
      // The fix is to correct the DOC — this constant is the record.
      expect(wrong).toEqual([]);
    });

    it(`${name}'s prose is structural too, one row weaker`, () => {
      const doc = parseWhy(readFileSync(file, 'utf8'));
      // Every row has prose, or the parser has drifted off the format and the
      // check below would be judging empty strings.
      expect([...doc.keys()].sort()).toEqual(Object.keys(SERVED_GAPS).sort());
      const bad: string[] = [];
      for (const [kind, why] of doc) {
        expect(why.length, `${kind} has no prose in ${name}`).toBeGreaterThan(40);
        bad.push(...unprovableGapProse(why, DOC_GAP_PROSE(`${name} · ${kind}`), []));
      }
      // The cross-module row stands down here and the other three do not: both
      // copies shipped the same "Three causes" sentence the constant did, which
      // is the whole reason judging the copies is worth a parser.
      expect(bad).toEqual([]);
    });

    it(`${name} does not blame a gap for an excused field`, () => {
      // The other direction of the same rot: a doc that keeps naming a field
      // the catalogue has moved to `UNGAPPED_FIELDS`. `omittedForAttention` sat
      // inside `no-receipt-on-chart` in both files until 9.88.0.
      const doc = parse(readFileSync(file, 'utf8'));
      const blamed = [...doc.values()].flat().filter((f) => coveredBy(UNGAPPED, f));
      expect(blamed).toEqual([]);
    });
  }
});
