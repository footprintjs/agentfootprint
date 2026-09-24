/**
 * `tryInsteadTool`, TYPED (9.113.0) — a suggestion to try another tool is
 * data a reader reads, never a tool name parsed out of prose.
 *
 * ## Why
 *
 * `absent({ tryInstead })` takes ONE sentence. A recorded collector absence
 * said (tool name generalised) "Widen the window, or check cluster_inventory
 * for the collected cluster names." — and a reader that wanted to know WHICH
 * tool the author pointed at could only find out by parsing that sentence,
 * which is the inference this library refuses to make. `tryInsteadTool: { tool, why? }`
 * names the tool as data, BESIDE the sentence and on its OWN wire key
 * (`try_instead_tool`): `try_instead` stays a string, so every reader that
 * reads it as one — typed against `ToolAbsence` since the field shipped —
 * keeps reading exactly what it read. The sentence form keeps working, byte
 * for byte.
 *
 * ## The readers pinned here
 *
 *   • the ENVELOPE the model reads — the tool rides `try_instead_tool`, as
 *     declared, and `try_instead` stays the sentence (functional);
 *   • every reader of `try_instead` — it is a string or absent whatever was
 *     declared, and a reader that quotes it as printed keeps the sentence
 *     when the tool is named beside it (contract; the compile-level half is
 *     `test/type-regressions/AbsenceSuggestion.assignability.test.ts`);
 *   • the `agentfootprint.tools.absent` EVENT — carries `tryInstead` and
 *     `tryInsteadTool`, each as declared; before 9.113.0 it carried neither
 *     (integration);
 *   • the tool turn across a JSON CHECKPOINT — an envelope-in-history pin,
 *     NOT a reader: no typed field is checkpointed (events are not, and
 *     `coverageDeclared` never carries a suggestion), so what it proves is
 *     that the envelope's JSON in history reaches a fresh executor's request
 *     intact (integration);
 *   • the EVIDENCE corpus — the typed `tool` and `why` ground exactly as the
 *     sentence does; `looked_for` stays the one field withheld (security);
 *   • the dataset projection GUARD — keeps `try_instead_tool` among the
 *     declarations an adapter may not change (edge).
 *
 * And the two pinned as NOT reading it: the appended coverage block and the
 * `coverageDeclared` rows describe GROUND, and a suggestion is not ground
 * (regression).
 *
 * The sentence form's bytes are pinned against a reference generated on the
 * 9.112.2 tree BEFORE any source edit of this release, by this file in update
 * mode — and so are the runs of a `tryInstead` that is neither a sentence nor
 * the typed form (`false` from `cond && '…'`, a number, a list), which
 * 9.112.2 delivered as an absence with no suggestion (the second fixture,
 * generated the same way on the same tree):
 *
 *   AF_TRY_INSTEAD_REFERENCE=update npx vitest run \
 *     test/core/agent/coverage-try-instead.test.ts -t 'byte-identical'
 *
 * Sections follow Convention 3: Unit · Contract · Functional · Integration ·
 * Security & containment · Edge · Regression.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { disableDevMode, enableDevMode } from 'footprintjs';
import { describe, expect, it, vi } from 'vitest';

import {
  ABSENCE_NOTE,
  Agent,
  absent,
  askHuman,
  coverage,
  defineTool,
  isPaused,
  readAbsence,
  readCoverageResult,
  type AbsenceDeclaration,
  type EmitEvent,
  type ToolAbsence,
} from '../../../src/index.js';
import { absenceEvidenceProjection } from '../../../src/core/agent/coverage/index.js';
import {
  projectionSemanticsIssues,
  snapshotProjectionSemantics,
} from '../../../src/lib/semantics/projection.js';
import type { LLMMessage, LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/** The tool the recorded collector absence pointed at, inside its sentence. */
const INVENTORY = 'cluster_inventory';
const INVENTORY_WHY = 'it lists the collected cluster names';
const TYPED = { tool: INVENTORY, why: INVENTORY_WHY } as const;

const LOOKED_FOR = 'latency samples for the named cluster';
const CHECKED = 'collected latency samples over the last 1h';
const EXISTENCE = {
  what: 'whether the cluster exists at all',
  why: 'this reads collected samples, not the cluster',
} as const;

/** The recorded sentence — the tool's name is inside it. */
const FLAGSHIP_TEXT =
  'Widen the window, or check cluster_inventory for the collected cluster names.';

/** As recorded: one sentence, and the tool is inside it. */
const FLAGSHIP_SENTENCE: AbsenceDeclaration = {
  what: LOOKED_FOR,
  checked: [CHECKED],
  notChecked: [EXISTENCE],
  tryInstead: FLAGSHIP_TEXT,
};

/**
 * The same absence with the tool named as data BESIDE the sentence — the
 * README's example. The sentence is kept as it was: it is what the model is
 * told, "widen the window" included.
 */
const FLAGSHIP_TYPED: AbsenceDeclaration = { ...FLAGSHIP_SENTENCE, tryInsteadTool: TYPED };

/** The tool alone, no sentence — allowed, and nothing is composed for it. */
const TOOL_ONLY: AbsenceDeclaration = {
  what: LOOKED_FOR,
  checked: [CHECKED],
  notChecked: [EXISTENCE],
  tryInsteadTool: TYPED,
};

/** No suggestion of either kind. */
const NONE: AbsenceDeclaration = { what: LOOKED_FOR, checked: [CHECKED], notChecked: [EXISTENCE] };

/** The README's sentence-form absence — the string form's byte pin. */
const SENTENCE_DECL: AbsenceDeclaration = {
  what: 'FLOGI entries on fc1/3',
  checked: ['shq-fab-a: the live fcns database', 'window: the last 24h'],
  notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
  cannotCover: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
  tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
};

/**
 * Values a caller outside the type (JavaScript, a cast, an `any`-typed row)
 * can put in `tryInstead` that are neither a sentence nor the typed form.
 * 9.112.2 read every one of them as "no suggestion" and delivered the
 * absence; the labels are the keys of the 9.112.2 reference for them.
 */
const NOT_A_SENTENCE: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['false', false],
  ['true', true],
  ['0', 0],
  ['42', 42],
  ['NaN', Number.NaN],
  ["['a']", ['a']],
  ['a list of sentences', ['Widen the window.']],
  ['a Date', new Date(0)],
];

type Ev = Record<string, unknown>;

/** An emit recorder that keeps the payloads of ONE event name. */
const keeping = (id: string, name: string, into: Ev[]) => ({
  id,
  onEmit: (e: EmitEvent) => {
    if (e.name === name) into.push((e.payload ?? {}) as Ev);
  },
});

/**
 * A scripted provider that keeps what it was sent — the bytes each model call
 * read, copied at the moment it read them.
 */
const recording = (replies: readonly Partial<LLMResponse>[]) => {
  const sent: LLMMessage[][] = [];
  const provider: LLMProvider = {
    name: 'mock',
    complete: async (req) => {
      sent.push(JSON.parse(JSON.stringify(req.messages)) as LLMMessage[]);
      const reply = replies[sent.length - 1];
      if (reply === undefined) throw new Error(`unscripted model call #${sent.length}`);
      return {
        content: '',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
        ...reply,
      } as LLMResponse;
    },
  };
  return { provider, sent };
};

const callTool = (name: string, id: string): Partial<LLMResponse> => ({
  toolCalls: [{ id, name, args: {} }],
});
const answer = (content: string): Partial<LLMResponse> => ({ content });

/** A tool that answers with one absence. */
const absenceTool = (value: () => unknown, name = 'cluster_latency') =>
  defineTool({
    name,
    description: 'Latency samples for one cluster',
    inputSchema: { type: 'object', properties: {} },
    execute: () => value(),
  });

/** One real loop: the tool answers with the absence, the model answers. */
const runOnce = async (
  value: () => unknown,
  opts: { readonly limits?: boolean; readonly grouped?: boolean } = {},
) => {
  const absences: Ev[] = [];
  const toolEnds: Ev[] = [];
  const { provider, sent } = recording([
    callTool('cluster_latency', 't1'),
    answer('Nothing was collected for it.'),
  ]);
  let builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 4,
    ...(opts.grouped === true && { reactMode: 'dynamic-grouped' as const }),
  })
    .system('You triage storage clusters.')
    .tool(absenceTool(value));
  if (opts.limits === true) builder = builder.limitsTravelWithTheAnswer();
  const agent = builder
    .watch(keeping('capture-try-instead', 'agentfootprint.tools.absent', absences))
    .watch(keeping('capture-try-instead-ends', 'agentfootprint.stream.tool_end', toolEnds))
    .build();
  const out = await agent.run('is the cluster slow?');
  const state = agent.getLastSnapshot()?.sharedState as {
    history: LLMMessage[];
    coverageDeclared?: unknown;
  };
  const toolTurn = state.history.find((m) => m.role === 'tool')?.content ?? '';
  return {
    answer: String(out),
    absences,
    toolEnds,
    toolTurn,
    sent,
    coverageDeclared: state.coverageDeclared,
  };
};

/** Every string a projection would put into the evidence corpus, flattened. */
const leavesOf = (value: unknown): string[] => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    else if (typeof node === 'number' || typeof node === 'boolean') out.push(String(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(value);
  return out;
};

/** An envelope minted OUTSIDE `absent()` — a non-JS producer, by hand. */
const mintedElsewhere = (suggestion: Record<string, unknown>): Record<string, unknown> => ({
  af_absent: true,
  outcome: 'nothing_found',
  looked_for: 'x',
  checked: [{ what: 'a source' }],
  retry_returns_the_same: true,
  ...suggestion,
  note: ABSENCE_NOTE,
});

/**
 * A reader written against the 9.112.2 contract — `try_instead` is a string —
 * quoting it as printed: the served tool turn read as an absence, and its
 * `try_instead` kept only when it is a non-blank string. Every reader that
 * quotes the suggestion is an instance of this; the typed tool must never
 * reach it as a second shape it would drop.
 */
const quotedSentence = (served: string): string | undefined => {
  const said: unknown = readAbsence(JSON.parse(served))?.try_instead;
  return typeof said === 'string' && said.trim() !== '' ? said : undefined;
};

// ─────────────────────────────────────────────────────────────────────────
// Unit — absent() takes the typed tool beside the sentence
// ─────────────────────────────────────────────────────────────────────────

describe('unit: absent() takes a typed tool beside the sentence', () => {
  it('renders the tool under its own key, and leaves the sentence where it was', () => {
    const minted = absent(FLAGSHIP_TYPED);
    expect(minted.try_instead).toBe(FLAGSHIP_TEXT);
    expect(minted.try_instead_tool).toEqual(TYPED);
  });

  it('the tool alone is allowed — no sentence is composed for it', () => {
    const minted = absent(TOOL_ONLY);
    expect('try_instead' in minted).toBe(false);
    expect(minted.try_instead_tool).toEqual(TYPED);
  });

  it('trims both fields, and a tool with no `why` carries no `why` key', () => {
    const bare = absent({ ...NONE, tryInsteadTool: { tool: `  ${INVENTORY} ` } });
    expect(bare.try_instead_tool).toEqual({ tool: INVENTORY });
    expect(Object.keys(bare.try_instead_tool ?? {})).toEqual(['tool']);
    const padded = absent({
      ...NONE,
      tryInsteadTool: { tool: INVENTORY, why: `  ${INVENTORY_WHY}  ` },
    });
    expect(padded.try_instead_tool).toEqual(TYPED);
  });

  it('does not look the tool up — a name no registry here knows is accepted as declared', () => {
    // A provider may serve it on a later iteration, or another agent may own
    // it. What `absent()` requires is a non-empty name, never its existence.
    const later = absent({ ...NONE, tryInsteadTool: { tool: 'served_by_a_provider_later' } });
    expect(later.try_instead_tool).toEqual({ tool: 'served_by_a_provider_later' });
  });

  it('the rendered tool is a copy — editing the declaration afterwards changes nothing', () => {
    const suggestion = { tool: INVENTORY, why: INVENTORY_WHY };
    const minted = absent({ ...NONE, tryInsteadTool: suggestion });
    suggestion.tool = 'something_else';
    expect(minted.try_instead_tool).toEqual(TYPED);
    expect(minted.try_instead_tool).not.toBe(suggestion);
  });

  it('`null` reads as not given — for the sentence, the tool and its `why`', () => {
    // `tryInstead: null` read as no suggestion before 9.113.0; refusing it now
    // would turn a nothing-found into a tool error. The new key follows it,
    // and so does `why` (a JSON producer writes a missing value as null).
    const loose = (decl: Record<string, unknown>) =>
      absent({ ...NONE, ...decl } as unknown as AbsenceDeclaration);
    expect('try_instead' in loose({ tryInstead: null })).toBe(false);
    expect('try_instead_tool' in loose({ tryInsteadTool: null })).toBe(false);
    expect(loose({ tryInsteadTool: { tool: INVENTORY, why: null } }).try_instead_tool).toEqual({
      tool: INVENTORY,
    });
  });
});

describe('unit: a malformed suggestion is refused where it is typed', () => {
  const refuse = (decl: Record<string, unknown>) => () =>
    absent({ what: 'x', checked: ['a source'], ...decl } as unknown as AbsenceDeclaration);
  const tool = (tryInsteadTool: unknown) => refuse({ tryInsteadTool });

  it('refuses a tool suggestion that names no tool', () => {
    expect(tool({ why: INVENTORY_WHY })).toThrow(/`tryInsteadTool\.tool` must name the tool/);
    expect(tool({ tool: '   ' })).toThrow(/`tryInsteadTool\.tool` must name the tool/);
    expect(tool({ tool: 42 })).toThrow(/`tryInsteadTool\.tool` must name the tool/);
  });

  it('refuses a `why` that is not a sentence', () => {
    expect(tool({ tool: INVENTORY, why: 7 })).toThrow(/`tryInsteadTool\.why`/);
    expect(tool({ tool: INVENTORY, why: '   ' })).toThrow(/`tryInsteadTool\.why`/);
  });

  it('refuses a key the form does not have — a misspelt `why` must not vanish', () => {
    expect(tool({ tool: INVENTORY, reason: INVENTORY_WHY })).toThrow(
      /unknown key 'reason'[\s\S]*\{ tool, why\? \}/,
    );
  });

  it('refuses a list — an absence names ONE tool', () => {
    expect(tool([{ tool: INVENTORY }])).toThrow(/ONE tool/);
    expect(tool([{ tool: INVENTORY }, { tool: 'another_tool' }])).toThrow(/ONE tool/);
  });

  it('refuses a tool suggestion that is not an object', () => {
    expect(tool(INVENTORY)).toThrow(/must be \{ tool, why\? \} — got string/);
    expect(tool(42)).toThrow(/must be \{ tool, why\? \} — got number/);
  });

  it('refuses a plain object in the sentence slot, and points it at `tryInsteadTool`', () => {
    // The typed form written where the sentence goes — the one non-string the
    // sentence slot refuses. Dropped, it would lose the author's tool silently.
    expect(refuse({ tryInstead: TYPED })).toThrow(/`tryInsteadTool`, beside the sentence/);
    expect(refuse({ tryInstead: {} })).toThrow(/`tryInsteadTool`, beside the sentence/);
    expect(refuse({ tryInstead: Object.assign(Object.create(null), TYPED) })).toThrow(
      /`tryInsteadTool`, beside the sentence/,
    );
  });

  it('any other value that is not a sentence reads as no suggestion — as before 9.113.0, never a tool error', () => {
    // `absent()` runs inside a tool's `execute`: a refusal here reaches the
    // model as that call's ERROR result, where 9.112.2 delivered the absence
    // with no suggestion. `false` is what `tryInstead: cond && '…'` gives.
    const bare = JSON.stringify(absent({ what: 'x', checked: ['a source'] }));
    for (const [label, value] of NOT_A_SENTENCE) {
      const mint = () =>
        absent({
          what: 'x',
          checked: ['a source'],
          tryInstead: value,
        } as unknown as AbsenceDeclaration);
      expect(mint, label).not.toThrow();
      expect(JSON.stringify(mint()), label).toBe(bare);
    }
  });

  it('the sentence form is untouched: trimmed, and an empty one is omitted as it always was', () => {
    const trimmed = absent({ what: 'x', checked: ['a source'], tryInstead: '  Ask again.  ' });
    expect(trimmed.try_instead).toBe('Ask again.');
    const empty = absent({ what: 'x', checked: ['a source'], tryInstead: '   ' });
    expect('try_instead' in empty).toBe(false);
  });
});

describe("unit: the tool's name is the tool registry's question, answered by its owner", () => {
  // `core/tools.ts` · `warnIfInvalidToolName` — dev mode warns, nothing
  // refuses — is what a `defineTool` of the same name gets. A suggestion is
  // held to exactly that, never to a second rule of its own.
  it('a name a provider would refuse is recorded as declared, and warned about in dev mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const quiet = absent({ ...NONE, tryInsteadTool: { tool: 'cluster inventory' } });
      expect(quiet.try_instead_tool).toEqual({ tool: 'cluster inventory' });
      expect(warn).not.toHaveBeenCalled();

      enableDevMode();
      const loud = absent({ ...NONE, tryInsteadTool: { tool: 'cluster inventory' } });
      expect(loud.try_instead_tool).toEqual({ tool: 'cluster inventory' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/invalid tool name "cluster inventory"/);

      absent({ ...NONE, tryInsteadTool: TYPED });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });
});

describe('unit: the one recognizer lifts each suggestion as declared, and guesses at nothing', () => {
  it('lifts the sentence and the tool, each only when declared', () => {
    const both = readCoverageResult(absent(FLAGSHIP_TYPED))?.declared[0];
    expect(both?.tryInstead).toBe(FLAGSHIP_TEXT);
    expect(both?.tryInsteadTool).toEqual(TYPED);
    const sentence = readCoverageResult(absent(FLAGSHIP_SENTENCE))?.declared[0];
    expect(sentence?.tryInstead).toBe(FLAGSHIP_TEXT);
    expect(sentence).not.toHaveProperty('tryInsteadTool');
    const toolOnly = readCoverageResult(absent(TOOL_ONLY))?.declared[0];
    expect(toolOnly).not.toHaveProperty('tryInstead');
    expect(toolOnly?.tryInsteadTool).toEqual(TYPED);
    const none = readCoverageResult(absent(NONE))?.declared[0];
    expect(none).not.toHaveProperty('tryInstead');
    expect(none).not.toHaveProperty('tryInsteadTool');
  });

  it('lifts it from an absence inside a ledger, and never onto the ledger itself', () => {
    const both = readCoverageResult(coverage(absent(FLAGSHIP_TYPED), { checked: ['one cluster'] }));
    expect(both?.declared.map((d) => d.kind)).toEqual(['ledger', 'absence']);
    expect(both?.declared[1]?.tryInsteadTool).toEqual(TYPED);
    expect(both?.declared[0]).not.toHaveProperty('tryInsteadTool');
    expect(both?.declared[0]).not.toHaveProperty('tryInstead');
  });

  it('an envelope minted elsewhere is read on the rules absent() applies', () => {
    const read = (suggestion: Record<string, unknown>) =>
      readCoverageResult(mintedElsewhere(suggestion))?.declared[0];
    expect(read({ try_instead_tool: TYPED })?.tryInsteadTool).toEqual(TYPED);
    expect(read({ try_instead: 'Ask again.' })?.tryInstead).toBe('Ask again.');
    // A JSON producer's `null` for a missing `why` loses nothing.
    expect(read({ try_instead_tool: { tool: 'inventory', why: null } })?.tryInsteadTool).toEqual({
      tool: 'inventory',
    });
  });

  it('a value absent() would refuse, or read as no suggestion, is not read — and the absence still is', () => {
    for (const bad of [
      42,
      ['a'],
      { tool: 7 },
      { tool: '   ' },
      { tool: INVENTORY, why: 5 },
      { tool: INVENTORY, rank: 1 },
      { why: INVENTORY_WHY },
    ]) {
      const reading = readCoverageResult(mintedElsewhere({ try_instead_tool: bad }));
      expect(reading?.status).toBe('absent');
      expect(reading?.declared[0]).not.toHaveProperty('tryInsteadTool');
    }
    for (const bad of [42, false, TYPED, '   ']) {
      const reading = readCoverageResult(mintedElsewhere({ try_instead: bad }));
      expect(reading?.status).toBe('absent');
      expect(reading?.declared[0]).not.toHaveProperty('tryInstead');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Contract — every reader of `try_instead` still reads a string
// ─────────────────────────────────────────────────────────────────────────

describe('contract: `try_instead` stays a string, so no reader of it loses the suggestion', () => {
  it('whatever absent() accepts, `try_instead` on the wire is the sentence or absent — never an object', () => {
    // One candidate offers the typed tool in the SENTENCE slot, as a reader of
    // the design might write it: refused where it is typed, so it never
    // reaches the wire as a second shape of `try_instead`. The values that
    // are neither read as no suggestion, and put nothing on the wire.
    const candidates: readonly unknown[] = [
      FLAGSHIP_SENTENCE,
      FLAGSHIP_TYPED,
      TOOL_ONLY,
      NONE,
      { ...NONE, tryInstead: TYPED },
      ...NOT_A_SENTENCE.map(([, value]) => ({ ...NONE, tryInstead: value })),
    ];
    let accepted = 0;
    for (const decl of candidates) {
      let minted: ToolAbsence;
      try {
        minted = absent(decl as AbsenceDeclaration);
      } catch {
        continue;
      }
      accepted += 1;
      const wire = JSON.parse(JSON.stringify(minted)) as Record<string, unknown>;
      expect(['string', 'undefined']).toContain(typeof wire.try_instead);
    }
    expect(accepted).toBe(4 + NOT_A_SENTENCE.length);
  });

  it('a reader that quotes `try_instead` as printed keeps the sentence when the tool is named beside it', async () => {
    // Through a real run: the served tool turn, read the way a quoting
    // reader written against 9.112.2 reads it.
    const sentence = await runOnce(() => absent(FLAGSHIP_SENTENCE));
    const typed = await runOnce(() => absent(FLAGSHIP_TYPED));
    expect(quotedSentence(sentence.toolTurn)).toBe(FLAGSHIP_TEXT);
    expect(quotedSentence(typed.toolTurn)).toBe(FLAGSHIP_TEXT);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the envelope the model reads
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the envelope the model reads carries the tool as declared', () => {
  it('as JSON: `try_instead`, then `try_instead_tool`, then the note — nothing else moves', () => {
    expect(JSON.stringify(absent(FLAGSHIP_TYPED))).toBe(
      '{"af_absent":true,"outcome":"nothing_found",' +
        '"looked_for":"latency samples for the named cluster",' +
        '"checked":[{"what":"collected latency samples over the last 1h"}],' +
        '"not_checked":[{"what":"whether the cluster exists at all",' +
        '"why":"this reads collected samples, not the cluster"}],' +
        '"retry_returns_the_same":true,' +
        '"try_instead":"Widen the window, or check cluster_inventory for the collected cluster names.",' +
        '"try_instead_tool":{"tool":"cluster_inventory","why":"it lists the collected cluster names"},' +
        `"note":${JSON.stringify(ABSENCE_NOTE)}}`,
    );
  });

  it('the tool alone sits where the sentence would, before the note', () => {
    expect(Object.keys(absent(TOOL_ONLY)).slice(-3)).toEqual([
      'retry_returns_the_same',
      'try_instead_tool',
      'note',
    ]);
  });

  it('the library composes no sentence for it — the note is the same bytes in every form', () => {
    for (const decl of [FLAGSHIP_SENTENCE, FLAGSHIP_TYPED, TOOL_ONLY]) {
      expect(absent(decl).note).toBe(ABSENCE_NOTE);
    }
  });

  it('reads as an ANSWER, never as a failure — the typed tool adds no word of a broken call', () => {
    const { note: _note, ...fields } = absent(FLAGSHIP_TYPED);
    const text = JSON.stringify(fields).toLowerCase();
    for (const word of ['error', 'failed', 'failure', 'exception', 'unavailable', 'timed out']) {
      expect(text).not.toContain(word);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the event, the tool turn, and a JSON checkpoint
// ─────────────────────────────────────────────────────────────────────────

describe('integration: tools.absent and the tool turn carry the suggestion, as declared', () => {
  it('the event carries the sentence and the tool — and the model read the same envelope', async () => {
    const t = await runOnce(() => absent(FLAGSHIP_TYPED));
    expect(t.toolEnds[0]?.status).toBe('absent');
    expect(t.absences).toHaveLength(1);
    expect(t.absences[0]?.tryInstead).toBe(FLAGSHIP_TEXT);
    expect(t.absences[0]?.tryInsteadTool).toEqual(TYPED);
    expect(readAbsence(JSON.parse(t.toolTurn))?.try_instead_tool).toEqual(TYPED);
    // The bytes the SECOND model call was sent — the one that read the result.
    const sentTurn = t.sent[1]?.find((m) => m.role === 'tool' && m.toolCallId === 't1');
    const read = readAbsence(JSON.parse(String(sentTurn?.content)));
    expect(read?.try_instead).toBe(FLAGSHIP_TEXT);
    expect(read?.try_instead_tool).toEqual(TYPED);
  });

  it('the sentence alone rides the event verbatim — never parsed for a tool', async () => {
    const t = await runOnce(() => absent(FLAGSHIP_SENTENCE));
    expect(t.absences[0]?.tryInstead).toBe(FLAGSHIP_TEXT);
    expect('tryInsteadTool' in (t.absences[0] ?? {})).toBe(false);
  });

  it('the tool alone rides the event with no sentence key', async () => {
    const t = await runOnce(() => absent(TOOL_ONLY));
    expect(t.absences[0]?.tryInsteadTool).toEqual(TYPED);
    expect('tryInstead' in (t.absences[0] ?? {})).toBe(false);
  });

  it('an absence that suggests nothing carries neither key on the event', async () => {
    const t = await runOnce(() => absent(NONE));
    expect(t.absences).toHaveLength(1);
    expect('tryInstead' in (t.absences[0] ?? {})).toBe(false);
    expect('tryInsteadTool' in (t.absences[0] ?? {})).toBe(false);
  });

  it('the event holds a copy — not the object the tool returned', async () => {
    const minted = absent(FLAGSHIP_TYPED);
    const t = await runOnce(() => minted);
    expect(t.absences[0]?.tryInsteadTool).toEqual(TYPED);
    expect(t.absences[0]?.tryInsteadTool).not.toBe(minted.try_instead_tool);
  });

  it('the grouped chart carries it the same — one dispatch boundary, not a copy of it', async () => {
    const t = await runOnce(() => absent(FLAGSHIP_TYPED), { grouped: true });
    expect(t.absences[0]?.tryInsteadTool).toEqual(TYPED);
  });

  it('an absence bounded by a ledger files the suggestion on its tools.absent row', async () => {
    const t = await runOnce(() =>
      coverage(absent(FLAGSHIP_TYPED), { checked: ['one cluster, the live collector'] }),
    );
    expect(t.absences).toHaveLength(1);
    expect(t.absences[0]?.tryInstead).toBe(FLAGSHIP_TEXT);
    expect(t.absences[0]?.tryInsteadTool).toEqual(TYPED);
  });
});

describe('integration: the tool turn in a JSON checkpoint still carries the typed tool', () => {
  // What rides the checkpoint is the tool turn (history): no typed field is
  // tracked (`coverageDeclared` never carries a suggestion) and events are not
  // checkpointed. So this pins the one path there is — the envelope's JSON in
  // the tool turn reaches a fresh executor's request intact.
  it('pauses after the absence, survives JSON, and the resumed model call reads the same object', async () => {
    const askFirst = defineTool({
      name: 'ask_first',
      description: 'Ask the person which cluster they meant',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'Which cluster did you mean?' }),
    });
    const absences: Ev[] = [];
    const build = (provider: LLMProvider) =>
      Agent.create({ provider, model: 'mock', maxIterations: 4 })
        .system('You triage storage clusters.')
        .tool(absenceTool(() => absent(FLAGSHIP_TYPED)))
        .tool(askFirst)
        .watch(keeping('capture-try-instead-checkpoint', 'agentfootprint.tools.absent', absences))
        .build();

    const first = recording([callTool('cluster_latency', 't1'), callTool('ask_first', 't2')]);
    const paused = await build(first.provider).run('is the cluster slow?');
    expect(isPaused(paused)).toBe(true);
    expect(absences).toHaveLength(1);
    expect(absences[0]?.tryInsteadTool).toEqual(TYPED);

    const stored: unknown = JSON.parse(
      JSON.stringify((paused as { readonly checkpoint: unknown }).checkpoint),
    );
    const second = recording([answer('Nothing was collected for it.')]);
    const out = await build(second.provider).resume(stored as never, 'the one in the east lab');
    expect(out).toBe('Nothing was collected for it.');

    const resumedTurn = second.sent[0]?.find((m) => m.role === 'tool' && m.toolCallId === 't1');
    expect(resumedTurn).toBeDefined();
    const read = readAbsence(JSON.parse(String(resumedTurn?.content)));
    expect(read?.try_instead).toBe(FLAGSHIP_TEXT);
    expect(read?.try_instead_tool).toEqual(TYPED);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security & containment — the typed tool grounds as the sentence does
// ─────────────────────────────────────────────────────────────────────────

describe('security: the typed tool is tool-authored words, and grounds as the sentence does', () => {
  it('its `tool` and `why` reach the evidence corpus; `looked_for` still does not', () => {
    const text = leavesOf(absenceEvidenceProjection(absent(TOOL_ONLY))).join(' | ');
    expect(text).toContain(INVENTORY);
    expect(text).toContain(INVENTORY_WHY);
    expect(text).not.toContain(LOOKED_FOR);
  });

  it('through the real gate: an answer that names the suggested tool is not flagged', async () => {
    // A name with a digit: the gate's extractor only makes a candidate of a
    // token that has one, so a purely alphabetic name would pass unjudged.
    const suggested = 'inventory_v2';
    const checks: Ev[] = [];
    const { provider } = recording([
      callTool('cluster_latency', 't1'),
      answer(`Nothing was collected; ${suggested} lists the collected cluster names.`),
    ]);
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('You triage storage clusters.')
      .tool(
        absenceTool(() =>
          absent({ ...NONE, tryInsteadTool: { tool: suggested, why: INVENTORY_WHY } }),
        ),
      )
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .watch(keeping('capture-try-instead-gate', 'agentfootprint.agent.evidence_checked', checks))
      .build();
    await agent.run('is the cluster slow?');
    const verdict = checks.at(-1);
    expect(verdict).toBeDefined();
    const unsupported = ((verdict?.unsupported as Array<{ value: string }> | undefined) ?? []).map(
      (u) => u.value,
    );
    expect(unsupported).not.toContain(suggested);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge
// ─────────────────────────────────────────────────────────────────────────

describe('edge: the one recognizer is the one reader, whoever minted the envelope', () => {
  it('a hand-minted well-formed tool reaches the event; a malformed one does not, and the call is still absent', async () => {
    const good = await runOnce(() => mintedElsewhere({ try_instead_tool: TYPED }));
    expect(good.absences[0]?.tryInsteadTool).toEqual(TYPED);
    const bad = await runOnce(() =>
      mintedElsewhere({ try_instead_tool: { tool: INVENTORY, why: 5 } }),
    );
    expect(bad.toolEnds[0]?.status).toBe('absent');
    expect(bad.absences).toHaveLength(1);
    expect('tryInsteadTool' in (bad.absences[0] ?? {})).toBe(false);
  });

  it('the dataset projection guard keeps the typed tool among the declarations, and catches a rewrite or a drop', () => {
    // `lib/semantics/projection.ts` · `snapshotProjectionSemantics` — the
    // guard an adapter's projection must pass — lists the absence keys it
    // will not let an adapter change; `try_instead_tool` is one of them.
    const minted = absent(FLAGSHIP_TYPED);
    const snapshot = snapshotProjectionSemantics(minted);
    expect(snapshot.fields.get('result.try_instead')).toBe(JSON.stringify(FLAGSHIP_TEXT));
    expect(snapshot.fields.get('result.try_instead_tool')).toBe(JSON.stringify(TYPED));
    const rewritten = { ...minted, try_instead_tool: { tool: 'another_tool' } };
    expect(projectionSemanticsIssues(snapshot, rewritten).map((i) => i.field)).toEqual([
      'result.try_instead_tool',
    ]);
    const { try_instead_tool: _dropped, ...withoutTool } = minted;
    expect(projectionSemanticsIssues(snapshot, withoutTool).map((i) => i.field)).toEqual([
      'result.try_instead_tool',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — the sentence form, and the two readers that never read it
// ─────────────────────────────────────────────────────────────────────────

const REFERENCE_PATH = resolve(__dirname, 'fixtures/absent-try-instead-sentence.reference.json');
const UPDATE_REFERENCE = process.env.AF_TRY_INSTEAD_REFERENCE === 'update';

interface SentenceFormReference {
  /** `JSON.stringify(absent(SENTENCE_DECL))` — the README absence. */
  readonly envelope: string;
  /** `JSON.stringify(absent(FLAGSHIP_SENTENCE))` — the recorded one. */
  readonly flagshipEnvelope: string;
  /** Every message of both model calls, as the provider was handed them. */
  readonly sent: readonly (readonly LLMMessage[])[];
  /** The tool turn in the committed history. */
  readonly toolTurn: string;
  /** The answer, with `.limitsTravelWithTheAnswer()` appending its block. */
  readonly answer: string;
  /** Tracked state — the rows the block is composed from. */
  readonly coverageDeclared: unknown;
  /** `agentfootprint.tools.absent` as 9.112.2 filed it. */
  readonly absentEvent: Ev;
  readonly toolEndStatus: unknown;
}

describe('regression: the sentence form is byte-identical', () => {
  it('byte-identical to the 9.112.2 reference — the event gains `tryInstead`, and nothing else moves', async () => {
    const t = await runOnce(() => absent(SENTENCE_DECL), { limits: true });
    const observed: SentenceFormReference = {
      envelope: JSON.stringify(absent(SENTENCE_DECL)),
      flagshipEnvelope: JSON.stringify(absent(FLAGSHIP_SENTENCE)),
      sent: t.sent,
      toolTurn: t.toolTurn,
      answer: t.answer,
      coverageDeclared: t.coverageDeclared,
      absentEvent: t.absences[0] ?? {},
      toolEndStatus: t.toolEnds[0]?.status,
    };
    if (UPDATE_REFERENCE) {
      writeFileSync(REFERENCE_PATH, `${JSON.stringify(observed, null, 2)}\n`);
      return;
    }
    const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')) as SentenceFormReference;
    expect(observed.envelope).toBe(reference.envelope);
    expect(observed.flagshipEnvelope).toBe(reference.flagshipEnvelope);
    expect(JSON.stringify(observed.sent)).toBe(JSON.stringify(reference.sent));
    expect(observed.toolTurn).toBe(reference.toolTurn);
    expect(observed.answer).toBe(reference.answer);
    expect(JSON.stringify(observed.coverageDeclared)).toBe(
      JSON.stringify(reference.coverageDeclared),
    );
    expect(observed.toolEndStatus).toBe(reference.toolEndStatus);
    // The ONE byte change, and it is the point: the event gains `tryInstead`,
    // LAST, verbatim — every key 9.112.2 filed keeps its place and value.
    expect(JSON.stringify(observed.absentEvent)).toBe(
      JSON.stringify({ ...reference.absentEvent, tryInstead: SENTENCE_DECL.tryInstead }),
    );
  });
});

const NOT_A_SENTENCE_REFERENCE_PATH = resolve(
  __dirname,
  'fixtures/absent-try-instead-not-a-sentence.reference.json',
);

/** One real loop for one {@link NOT_A_SENTENCE} value, as 9.112.2 ran it. */
interface NotASentenceRun {
  readonly toolEndStatus: unknown;
  /** Every `agentfootprint.tools.absent` payload the run filed. */
  readonly absentEvents: readonly Ev[];
  /** The tool turn the SECOND model call was sent — the envelope it read. */
  readonly modelRead: unknown;
}

describe('regression: a `tryInstead` that is not a sentence still delivers the absence', () => {
  it('byte-identical to the 9.112.2 reference — status `absent`, one `tools.absent` event, the same envelope', async () => {
    const observed: Record<string, NotASentenceRun> = {};
    for (const [label, value] of NOT_A_SENTENCE) {
      const t = await runOnce(() =>
        absent({ ...SENTENCE_DECL, tryInstead: value } as unknown as AbsenceDeclaration),
      );
      observed[label] = {
        toolEndStatus: t.toolEnds[0]?.status,
        absentEvents: t.absences,
        modelRead: t.sent[1]?.find((m) => m.role === 'tool' && m.toolCallId === 't1')?.content,
      };
    }
    if (UPDATE_REFERENCE) {
      writeFileSync(NOT_A_SENTENCE_REFERENCE_PATH, `${JSON.stringify(observed, null, 2)}\n`);
      return;
    }
    const reference = JSON.parse(readFileSync(NOT_A_SENTENCE_REFERENCE_PATH, 'utf8')) as Record<
      string,
      NotASentenceRun
    >;
    expect(Object.keys(observed)).toEqual(Object.keys(reference));
    for (const [label] of NOT_A_SENTENCE) {
      const run = observed[label];
      const was = reference[label];
      expect(run?.toolEndStatus, label).toBe('absent');
      expect(run?.absentEvents, label).toHaveLength(1);
      expect(run?.toolEndStatus, label).toBe(was?.toolEndStatus);
      expect(JSON.stringify(run?.absentEvents), label).toBe(JSON.stringify(was?.absentEvents));
      expect(run?.modelRead, label).toBe(was?.modelRead);
    }
  });
});

describe('regression: the appended block and the tracked rows never read a suggestion', () => {
  const base: AbsenceDeclaration = {
    what: LOOKED_FOR,
    checked: [CHECKED],
    notChecked: [EXISTENCE],
    cannotCover: [{ what: 'host-side multipathing', why: 'no collector runs on the hosts' }],
  };

  it('none, a sentence, a typed tool or both — the same answer block and the same rows', async () => {
    const none = await runOnce(() => absent(base), { limits: true });
    const variants = [
      { tryInstead: FLAGSHIP_TEXT },
      { tryInsteadTool: TYPED },
      { tryInstead: FLAGSHIP_TEXT, tryInsteadTool: TYPED },
    ];
    // The block states GROUND; a suggestion is advice about a call not yet
    // made, and it would change the bytes of every answer that declared one.
    expect(none.answer).toContain('Coverage of this answer');
    for (const suggestion of variants) {
      const t = await runOnce(() => absent({ ...base, ...suggestion }), { limits: true });
      expect(t.answer).toBe(none.answer);
      expect(JSON.stringify(t.coverageDeclared)).toBe(JSON.stringify(none.coverageDeclared));
    }
  });
});
