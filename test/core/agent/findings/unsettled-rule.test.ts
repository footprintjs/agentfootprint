/**
 * Unit — the rule behind `unsettled-by-absence` (9.113.0,
 * `findings/unsettled.ts`): whose word decides that a result was an absence,
 * what the row carries, which standings it files a row beside, where the
 * row lands, and what the one writer does with it.
 *
 * Pattern: Test-as-specification over pure functions.
 * Role:    Pin the fences —
 *
 *   • TWO facts, two owners, both required. The dispatch door says the tool
 *     RETURNED an absence (a `kind: 'absence'` row on `coverageDeclared` for
 *     the standing's `toolCallId`) — never a second reading: a served string
 *     that LOOKS like an envelope (a tool that returned it as text), a
 *     zero-row array, a ledger-only boundary file nothing. And the model was
 *     SERVED an absence (the served string's leading JSON object reads as
 *     one, bare or bounded): the door records the return BEFORE the
 *     after-tool chain, a ceiling or placement act, so a deny, a refusal, a
 *     ticket, prose or a cut-off envelope files nothing;
 *   • the row's words are what the model was SERVED — the served object's
 *     lists (a bounding ledger's first, then the absence's) and its
 *     `try_instead` — so a scrub is honored and the door's copies are never
 *     quoted; read and never trusted: a malformed list or item never throws
 *     and never reaches the row, and every row filed passes the checkpoint
 *     door;
 *   • `try_instead` is the STRING as served, byte for byte — the served
 *     string's leading JSON object, so a framework note joined after it
 *     does not hide it — and only a non-blank string;
 *   • ONLY `ruled-out` gets a row, and only on a result the run identified;
 *   • the derived row lands immediately after its standing, and a batch
 *     with none returns the rows it was given, object for object;
 *   • the door's rows are read only when a ruled-out standing's served
 *     result reads as an absence, and at most once — an armed run that rules
 *     out only results that held something reads nothing new;
 *   • `recordFindings` emits nothing for it — the conflict row's precedent.
 *
 * Test types (Convention 3): unit / regression (the review findings — a text
 * envelope files nothing, a malformed list never throws, a withheld result
 * files nothing, a scrub is honored) / documentation (the row literals are
 * the row's shape).
 */

import { describe, expect, it } from 'vitest';

import { absent, coverage } from '../../../../src/index.js';
import {
  unsettledRowOf,
  withUnsettledRows,
} from '../../../../src/core/agent/findings/unsettled.js';
import {
  recordFindings,
  type FindingsScope,
  type PreviousResult,
} from '../../../../src/core/agent/findings/ledger.js';
import type { FindingsLedger, StandingRow } from '../../../../src/core/agent/findings/types.js';
import { readCoverageResult } from '../../../../src/core/agent/coverage/read.js';
import type { DeclaredCoverage } from '../../../../src/core/agent/coverage/types.js';
import { buildCheckpoint, validateCheckpoint } from '../../../../src/core/runCheckpoint.js';

// ─── fixtures ────────────────────────────────────────────────────────

const MISS = {
  what: 'HBAs on host nas-cluster-06',
  checked: ['the HBA table of every collected hypervisor host'],
  notChecked: [
    { what: 'whether nas-cluster-06 is a hypervisor host at all', why: 'HBA rows only' },
  ],
  cannotCover: [
    { what: 'hosts outside the collected inventory', why: 'one inventory per collector' },
  ],
  tryInstead: 'Look nas-cluster-06 up in cluster_inventory first.',
};
const LEDGER = {
  checked: ['every collector on the fabric'],
  notChecked: [{ what: 'the archive', why: 'older than the window' }],
  cannotCover: [{ what: 'the peer fabric', why: 'one fabric per collector' }],
};

/** A result as the dispatch loop serves an object it returned: stringified. */
const served = (value: unknown): string => JSON.stringify(value);

/**
 * The rows the dispatch door files for one RETURNED value — the shape
 * `stages/toolCalls.ts · declareCoverage` writes on `coverageDeclared`
 * (the one recognizer's reading, each item copied `{ what, why? }`). A
 * string return is never read there, so it files nothing.
 */
const door = (toolCallId: string, returned: unknown): DeclaredCoverage[] => {
  const reading = readCoverageResult(returned);
  if (reading === undefined) return [];
  const copy = (list: readonly { what: string; why?: string }[]) =>
    list.map((i) => ({ what: i.what, ...(i.why !== undefined && { why: i.why }) }));
  return reading.declared.map((facts) => ({
    kind: facts.kind,
    toolName: 'host_hbas',
    toolCallId,
    iteration: 1,
    ...(facts.lookedFor !== undefined && { lookedFor: facts.lookedFor }),
    checked: copy(facts.coverage.checked),
    notChecked: copy(facts.coverage.notChecked),
    cannotCover: copy(facts.coverage.cannotCover),
  }));
};

const standing = (
  toolCallId: string,
  kind: StandingRow['standing'],
  extra: Partial<StandingRow> = {},
): StandingRow => ({
  kind: 'standing',
  toolCallId,
  toolName: 'host_hbas',
  standing: kind,
  assertions: [],
  declaredOn: { toolCallId: 'c9' },
  iteration: 4,
  ...extra,
});

const known = (toolCallId: string, value: unknown): PreviousResult => ({
  toolCallId,
  toolName: 'host_hbas',
  result: typeof value === 'string' ? value : served(value),
});

/** The rule over one call, returned as `returned` and served as `servedAs`. */
const ruleOver = (returned: unknown, servedAs: string = served(returned)) =>
  unsettledRowOf(standing('c1', 'ruled-out'), [known('c1', servedAs)], door('c1', returned));

const F3_ROW = {
  kind: 'unsettled-by-absence',
  toolCallId: 'c1',
  notChecked: MISS.notChecked,
  cannotCover: MISS.cannotCover,
  tryInstead: MISS.tryInstead,
  iteration: 4,
};

// ─── 1. the witness is the door's ────────────────────────────────────

describe('unsettledRowOf — the door says whether it was an absence, never the rule', () => {
  it('an absence the door recorded: its lists, and its try_instead as served', () => {
    expect(ruleOver(absent(MISS))).toEqual(F3_ROW);
    // An absence that declares no boundary and no way out still IS one: the
    // lists and the way out are absent, never empty arrays.
    expect(ruleOver(absent({ what: 'x', checked: ['y'] }))).toEqual({
      kind: 'unsettled-by-absence',
      toolCallId: 'c1',
      iteration: 4,
    });
  });

  it('an absence bounded by coverage(): the ledger’s lists first, then the absence’s — the order the door filed them', () => {
    expect(ruleOver(coverage(absent(MISS), LEDGER))).toEqual({
      ...F3_ROW,
      notChecked: [...LEDGER.notChecked, ...MISS.notChecked],
      cannotCover: [...LEDGER.cannotCover, ...MISS.cannotCover],
    });
    // The same item twice (the ledger and the absence both name it) is merged once.
    const twice = coverage(absent(MISS), { notChecked: MISS.notChecked });
    expect(ruleOver(twice)?.notChecked).toEqual(MISS.notChecked);
  });

  it('an envelope a tool returned as TEXT was no absence at the door, so the rule files nothing', () => {
    // The served string is byte-identical to an object return's — which is
    // exactly why the served string cannot be the witness: the door never
    // parses a string, files no row, delivers no `'absent'`.
    const text = served(absent(MISS));
    expect(door('c1', text)).toEqual([]);
    expect(ruleOver(text, text)).toBeUndefined();
    expect(ruleOver(served(coverage(absent(MISS), LEDGER)), text)).toBeUndefined();
  });

  it('a zero-row array is not read: no door records a zero-row reading, returned or served', () => {
    expect(ruleOver([])).toBeUndefined();
    expect(ruleOver('[]', '[]')).toBeUndefined();
    // A boundary around an empty result is a LEDGER at the door, not an absence.
    expect(ruleOver(coverage([], LEDGER))).toBeUndefined();
  });

  it('a result that holds something, a bare wrapper, prose — the door recorded no absence: nothing', () => {
    for (const returned of [
      [{ host: 'esx-01' }],
      coverage([{ host: 'esx-01' }], LEDGER),
      // The recorded F3 result: a bare wrapper no law reads.
      { hba_count: 0, hbas: [] },
      { not_found: true, count: 0 },
      'no HBAs found for nas-cluster-06',
      // A malformed marker: `readAbsence` refuses both at the door.
      { af_absent: true, checked: [] },
      { af_absent: 'yes', checked: ['x'] },
    ]) {
      expect(ruleOver(returned), JSON.stringify(returned)).toBeUndefined();
    }
  });

  it('the door’s rows are keyed by call: another call’s absence is no witness for this one', () => {
    expect(
      unsettledRowOf(
        standing('c1', 'ruled-out'),
        [known('c1', [{ host: 'esx-01' }]), known('c2', absent(MISS))],
        door('c2', absent(MISS)),
      ),
    ).toBeUndefined();
  });
});

// ─── 2. try_instead, as served ───────────────────────────────────────

describe('unsettledRowOf — try_instead is the string the model was served, and only a string', () => {
  it('a framework note joined AFTER the envelope does not hide it: the served string’s leading object is read', () => {
    const envelope = absent({
      ...MISS,
      // Braces, brackets, quotes and a backslash inside the strings: the
      // extent is found by the JSON grammar, never by the first `}`.
      tryInstead: 'Ask for {"host": "x"} or [the "cluster"] \\ inventory } ] first.',
    });
    for (const note of [
      ' Step 1 of 2 done. Now on step 2 of 2: check the cluster (tool: `cluster_inventory`).',
      ' [tool effect refused: no such skill]',
      '\n\n[the repeated-call note joined this line]',
    ]) {
      const row = ruleOver(envelope, `${served(envelope)}${note}`);
      expect(row?.tryInstead, note).toBe(envelope.try_instead);
      expect(row?.notChecked).toEqual(MISS.notChecked);
    }
    // Bounded by coverage() and decorated: the same.
    const bounded = coverage(envelope, LEDGER);
    expect(ruleOver(bounded, `${served(bounded)} Step 1 of 2 done.`)?.tryInstead).toBe(
      envelope.try_instead,
    );
  });

  it('a result the model was NOT served as an absence files nothing — the door recorded what the tool returned, before anything replaced it', () => {
    // An after-tool deny, a ceiling's refusal, a placement ticket, a summary,
    // an agent cap's cut, an object ahead of the envelope: the model ruled
    // out on what it read, and it read no absence. The door's rows still say
    // absence — the tool's fact — and quoting them here would serve words
    // governance withheld under a claim the model never made.
    for (const text of [
      'HBA data is withheld for this user.',
      'the lookup found nothing worth showing',
      served({ placed: true, ref: 'art_1', kind: 'k', mediaType: 'm', bytes: 9, reason: 'r' }),
      '{"af_absent": true, "checked": ["the HBA table"], "try_instead": "cut off',
      `{"a": 1}${served(absent(MISS))}`,
    ]) {
      expect(ruleOver(absent(MISS), text), text).toBeUndefined();
    }
  });

  it('a scrubbed envelope: the row carries what the model was SERVED, never the door’s copies', () => {
    const envelope = absent(MISS);
    // The chain took `not_checked` out: the row has none.
    const { not_checked: _withheld, ...scrubbed } = envelope;
    expect(ruleOver(envelope, served(scrubbed))).toEqual({
      kind: 'unsettled-by-absence',
      toolCallId: 'c1',
      cannotCover: MISS.cannotCover,
      tryInstead: MISS.tryInstead,
      iteration: 4,
    });
    // The chain rewrote the lists and the way out: the row quotes the rewrite.
    const rewritten = {
      ...envelope,
      not_checked: [{ what: 'a host the model may be told about' }],
      try_instead: 'Ask the operator.',
    };
    expect(ruleOver(envelope, served(rewritten))).toEqual({
      kind: 'unsettled-by-absence',
      toolCallId: 'c1',
      notChecked: [{ what: 'a host the model may be told about' }],
      cannotCover: MISS.cannotCover,
      tryInstead: 'Ask the operator.',
      iteration: 4,
    });
  });

  it('try_instead is the string byte for byte — leading, trailing and doubled whitespace included', () => {
    const spaced = '  Look it up  in\tcluster_inventory.   \n';
    const envelope = { ...absent({ what: 'x', checked: ['y'] }), try_instead: spaced };
    expect(ruleOver(envelope)?.tryInstead).toBe(spaced);
  });

  it('try_instead that is not a non-blank string is not carried', () => {
    for (const said of [{ tool: 'cluster_inventory' }, 7, '', '   ']) {
      const envelope = { ...absent({ what: 'x', checked: ['y'] }), try_instead: said };
      expect(ruleOver(envelope), JSON.stringify(said)).toEqual({
        kind: 'unsettled-by-absence',
        toolCallId: 'c1',
        iteration: 4,
      });
    }
  });
});

// ─── 3. total: what other code wrote never throws ────────────────────

describe('unsettledRowOf — total over what other code wrote', () => {
  /** A foreign envelope — minted outside `absent()`, recognized at the door all the same. */
  const foreign = (fields: Record<string, unknown>) => ({
    af_absent: true,
    checked: ['the table'],
    ...fields,
  });

  it('a list that is not a list, and items that name no ground, never throw and never reach the row', () => {
    // As the door copies a foreign envelope's items: a string item becomes
    // `{ what: undefined }`, a missing `what` stays missing.
    const row = ruleOver(
      foreign({
        not_checked: [
          'a bare string',
          { why: 'no what' },
          { what: '   ', why: 'blank what' },
          { what: 'kept', why: 'the one well-formed item' },
          { what: 'kept too', why: 7 },
        ],
        cannot_cover: [{ what: '' }],
        try_instead: '',
      }),
    );
    expect(row).toEqual({
      kind: 'unsettled-by-absence',
      toolCallId: 'c1',
      notChecked: [{ what: 'kept', why: 'the one well-formed item' }, { what: 'kept too' }],
      iteration: 4,
    });
    // Every row the rule files passes the checkpoint door on resume.
    const cp = buildCheckpoint({
      runId: 'r-1',
      originalInput: { message: 'q' },
      history: [],
      lastCompletedIteration: 0,
    });
    const ledger = [standing('c1', 'ruled-out'), row!];
    const restored = validateCheckpoint(
      JSON.parse(JSON.stringify({ ...cp, findingsLedger: ledger })),
    );
    expect(restored.findingsLedger).toEqual(JSON.parse(JSON.stringify(ledger)));
  });

  it('door rows of any shape — a non-array list, null entries, a non-array record — are read for their kind alone and throw nothing', () => {
    const rows: unknown[] = [
      null,
      7,
      { kind: 'absence', toolCallId: 'c1', notChecked: 5, cannotCover: { what: 'x', why: 'y' } },
      { kind: 'ledger', toolCallId: 'c1', notChecked: [null, 3, { what: 'the archive' }] },
    ];
    // The door's `kind: 'absence'` row is the witness that the tool returned
    // an absence; the row's words are the SERVED envelope's, never the door's.
    expect(
      unsettledRowOf(
        standing('c1', 'ruled-out'),
        [known('c1', absent(MISS))],
        rows as DeclaredCoverage[],
      ),
    ).toEqual(F3_ROW);
    // No absence row among them (a ledger row alone): no witness, nothing filed.
    expect(
      unsettledRowOf(
        standing('c1', 'ruled-out'),
        [known('c1', absent(MISS))],
        rows.slice(3) as DeclaredCoverage[],
      ),
    ).toBeUndefined();
    expect(
      unsettledRowOf(
        standing('c1', 'ruled-out'),
        [known('c1', absent(MISS))],
        'not a list' as never,
      ),
    ).toBeUndefined();
  });
});

// ─── 4. the rule's scope ─────────────────────────────────────────────

describe('unsettledRowOf — only a ruled-out standing, only on a result the run identified', () => {
  const results = [known('c1', absent(MISS)), known('c2', [{ host: 'esx-01' }])];
  const declared = door('c1', absent(MISS));

  it('every other standing on the same absence files nothing — the rule reads ruled-out alone', () => {
    for (const kind of ['fact', 'open', 'noise'] as const) {
      expect(unsettledRowOf(standing('c1', kind), results, declared)).toBeUndefined();
    }
  });

  it('a real witness, and an id the run could not identify, file nothing', () => {
    expect(unsettledRowOf(standing('c2', 'ruled-out'), results, declared)).toBeUndefined();
    expect(
      unsettledRowOf(
        standing('c1', 'ruled-out', { unknownId: true, toolName: undefined }),
        results,
        declared,
      ),
    ).toBeUndefined();
  });
});

describe('withUnsettledRows — the derived row lands beside its standing', () => {
  const results = [known('c1', absent(MISS)), known('c2', [{ a: 1 }]), known('c4', absent(MISS))];
  const declared = [...door('c1', absent(MISS)), ...door('c4', absent(MISS))];

  it('each derived row immediately after the standing it is beside, in declaration order', () => {
    const s1 = standing('c1', 'ruled-out');
    const s2 = standing('c2', 'ruled-out');
    const s3 = standing('c1', 'fact');
    const s4 = standing('c4', 'ruled-out');
    const rows = withUnsettledRows([s1, s2, s3, s4], results, () => declared);
    expect(rows.map((r) => `${r.kind}:${(r as { toolCallId: string }).toolCallId}`)).toEqual([
      'standing:c1',
      'unsettled-by-absence:c1',
      'standing:c2',
      'standing:c1',
      'standing:c4',
      'unsettled-by-absence:c4',
    ]);
    // The standings are the objects the caller built — never copied, never edited.
    expect(rows[0]).toBe(s1);
    expect(rows[2]).toBe(s2);
  });

  it('a batch the rule files nothing beside comes back as the same rows, object for object', () => {
    const batch = [standing('c2', 'ruled-out'), standing('c1', 'noise')];
    const rows = withUnsettledRows(batch, results, () => declared);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(batch[0]);
    expect(rows[1]).toBe(batch[1]);
    expect(withUnsettledRows([], results, () => declared)).toEqual([]);
    // No door rows at all (a run whose tools declared nothing): nothing beside anything.
    expect(withUnsettledRows([standing('c1', 'ruled-out')], results, () => [])).toHaveLength(1);
  });

  it('the door’s rows are read only for a ruled-out standing whose result was SERVED as an absence, and at most once', () => {
    let reads = 0;
    const readDeclared = () => {
      reads += 1;
      return declared;
    };
    // No ruled-out standing (or only one the run could not identify): the
    // key is never read — an armed run that rules nothing out reads nothing new.
    withUnsettledRows(
      [
        standing('c1', 'fact'),
        standing('c2', 'open'),
        standing('c4', 'noise'),
        standing('c7', 'ruled-out', { unknownId: true, toolName: undefined }),
      ],
      results,
      readDeclared,
    );
    expect(reads).toBe(0);
    // A ruling-out on a result that held rows — the common case — reads
    // nothing either: the served string is read first, and it is no absence.
    expect(withUnsettledRows([standing('c2', 'ruled-out')], results, readDeclared)).toHaveLength(1);
    expect(reads).toBe(0);
    // Two ruled-out standings: one read, shared.
    const rows = withUnsettledRows(
      [standing('c1', 'ruled-out'), standing('c4', 'ruled-out')],
      results,
      readDeclared,
    );
    expect(reads).toBe(1);
    expect(rows.map((r) => r.kind)).toEqual([
      'standing',
      'unsettled-by-absence',
      'standing',
      'unsettled-by-absence',
    ]);
  });
});

// ─── 5. the one writer ───────────────────────────────────────────────

describe('recordFindings — files the derived row and emits nothing for it', () => {
  it('the standing event is the one it always was; no event names the derived row', () => {
    const emitted: { name: string; payload: unknown }[] = [];
    const scope: FindingsScope = {
      $emit: (name: string, payload?: unknown) => {
        emitted.push({ name, payload });
      },
    };
    const rows = withUnsettledRows([standing('c1', 'ruled-out')], [known('c1', absent(MISS))], () =>
      door('c1', absent(MISS)),
    );
    recordFindings(scope, rows);
    expect((scope.findingsLedger as FindingsLedger).map((r) => r.kind)).toEqual([
      'standing',
      'unsettled-by-absence',
    ]);
    expect(emitted.map((e) => e.name)).toEqual(['agentfootprint.findings.standing']);
    expect(emitted[0]!.payload).toEqual({
      toolCallId: 'c1',
      toolName: 'host_hbas',
      iteration: 4,
      standing: 'ruled-out',
      declaredOn: 'tool-call',
      assertionCount: 0,
    });
  });
});
