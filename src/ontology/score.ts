/**
 * ontology/score — did an answer name the declared gap, and where the need
 * would be met? Scored off the record, by declared strings, with no judge.
 *
 * Pattern: pure functions over the served spec and one turn's own facts
 *          (the answer text, the tool names called, the library's own
 *          unsupported-values verdict). No model, no clock, no I/O.
 * Role:    Lens, for a BENCH. It is the measuring stick the design page
 *          promised (docs/design/2026-09-ontology.md § Measured): the first
 *          number for "the answer names the source" was a regex over prose;
 *          this is the rule that replaces it, so every wording change is
 *          measured the same way. Exported on the `agentfootprint/ontology`
 *          door because the map's consumer runs the bench on ITS host with
 *          ITS questions, and the rules must be the library's, not re-derived
 *          there.
 * Emits:   N/A.
 *
 * THE LAW OF THE SCORE
 *   A check matches DECLARED STRINGS ONLY — a term's or a source's id and
 *   aliases, a tool's name — whole-word, case-insensitive, an `_` in an
 *   id standing for a space or a hyphen. Nothing fuzzier. So an answer that
 *   says "UCS Manager" when the source's id is `influx_ucs` and no alias says
 *   "UCS Manager" scores NO, and that is the point: the declaration must
 *   carry the words people use, because those are the words the model
 *   reads too. The scorer never decides an answer is good; it counts what
 *   the answer names.
 *
 * THE EXPECTATION IS THE BENCH AUTHOR'S, DECLARED BEFORE THE RUN
 *   `expected.gap` names the term or source the question turns on — the
 *   `_findings.expect` precedent: declared before the call, judged after. A
 *   gap that names nothing the spec declares is refused, naming it: a bench
 *   whose oracle lies must fail loudly, as a map naming an unregistered tool
 *   does at build.
 */

import type { OntologySpec } from './types.js';

/** What a bench question declares about itself, before the run. */
export interface AbsenceExpectation {
  /**
   * The declared gap the answer should name: a term id or a source id of
   * the served map. Absent when the question expects DATA, not a gap — then
   * only the counts are read and the two naming checks are `undefined`.
   */
  readonly gap?: string;
}

/** One turn's own facts, read off the record by the caller. */
export interface AbsenceTurn {
  /** The final answer, as returned. */
  readonly answer: string;
  /** The tool names the model called this turn, in order. */
  readonly toolCalls: readonly string[];
  /**
   * The library's own verdict on values the answer stated that no tool
   * result carried (`AgentState.unsupportedValues.values.length`), when the
   * evidence gate was armed and the record carries it. Absent otherwise.
   */
  readonly unsupportedValues?: number;
}

/** The score of one turn — every field a count, a yes/no, or the strings that matched. */
export interface AbsenceScore {
  /** The expected gap, as declared. */
  readonly gap: string | undefined;
  /** What the spec says the gap is. `'none'` when no gap was expected. */
  readonly gapKind: 'term' | 'source' | 'none';
  /** The answer contains the gap's id or one of its declared aliases. `undefined` when no gap was expected. */
  readonly namedGap: boolean | undefined;
  /**
   * The answer contains a declared neighbour of the gap — a source that holds
   * the term, a tool that reads it, a term one relation away; for a source,
   * a term it holds or a tool that reads through it. `undefined` when no gap
   * was expected or the spec declares no neighbour for it.
   */
  readonly namedWhere: boolean | undefined;
  /** The neighbours the answer named, by declared id — the evidence for `namedWhere`. */
  readonly where: readonly string[];
  /** The neighbours the spec declares for the gap — what `namedWhere` was checked against. */
  readonly neighbours: readonly string[];
  /** Tool calls this turn. */
  readonly toolCalls: number;
  /** The library's unsupported-values count, as handed in; `undefined` when the record carried none. */
  readonly unsupportedValues: number | undefined;
  /**
   * The words of the map the answer used on the person — `ontology`, `map`,
   * `declaration` and their forms, the header's own vocabulary the ask says
   * to keep from the person. A wording metric, reported as the words found.
   */
  readonly mapWords: readonly string[];
}

/** The tally over many turns — `k` of `n` per check, counts summed. */
export interface AbsenceSummary {
  readonly turns: number;
  readonly namedGap: { readonly k: number; readonly n: number };
  readonly namedWhere: { readonly k: number; readonly n: number };
  readonly citedMap: { readonly k: number; readonly n: number };
  readonly toolCalls: number;
  /** Summed over the turns whose record carried a verdict; `undefined` when none did. */
  readonly unsupportedValues: number | undefined;
}

/**
 * The header's own words, and the ask's: what the piece calls itself and
 * what the person should not hear. Each a stem, matched as a whole word or
 * a word beginning (`ontology`, `ontological`; `map`, `maps` — not `mapping`
 * as a verb is a judgment this list does not make, so `map` is exact).
 */
const MAP_WORDS: readonly RegExp[] = [/\bontolog\w*/gi, /\bmaps?\b/gi, /\bdeclar\w*/gi];

/**
 * Score one turn against the served map and the bench's expectation.
 * Throws when `expected.gap` names nothing the spec declares.
 */
export function scoreAbsence(
  spec: OntologySpec,
  turn: AbsenceTurn,
  expected: AbsenceExpectation = {},
): AbsenceScore {
  const counts = {
    toolCalls: turn.toolCalls.length,
    unsupportedValues: turn.unsupportedValues,
    mapWords: wordsOf(turn.answer),
  };
  if (expected.gap === undefined) {
    return {
      gap: undefined,
      gapKind: 'none',
      namedGap: undefined,
      namedWhere: undefined,
      where: [],
      neighbours: [],
      ...counts,
    };
  }
  const gap = expected.gap;
  const kind = kindOf(spec, gap);
  if (kind === undefined) {
    throw new Error(
      `scoreAbsence: expected gap '${gap}' is neither a term nor a source of ontology ` +
        `'${spec.id}' — the expectation must name what the map declares.`,
    );
  }
  const names = namesOf(spec, gap);
  const neighbours = neighboursOf(spec, gap, kind);
  const where = neighbours.filter((id) => mentions(turn.answer, namesOf(spec, id)));
  return {
    gap,
    gapKind: kind,
    namedGap: mentions(turn.answer, names),
    namedWhere: neighbours.length === 0 ? undefined : where.length > 0,
    where,
    neighbours,
    ...counts,
  };
}

/** The tally: `k` of `n` per yes/no check over the turns that had one; counts summed. */
export function summarizeAbsence(scores: readonly AbsenceScore[]): AbsenceSummary {
  const tally = (pick: (s: AbsenceScore) => boolean | undefined) => {
    const asked = scores.filter((s) => pick(s) !== undefined);
    return { k: asked.filter((s) => pick(s) === true).length, n: asked.length };
  };
  const withVerdict = scores.filter((s) => s.unsupportedValues !== undefined);
  return {
    turns: scores.length,
    namedGap: tally((s) => s.namedGap),
    namedWhere: tally((s) => s.namedWhere),
    citedMap: tally((s) => s.mapWords.length > 0),
    toolCalls: scores.reduce((n, s) => n + s.toolCalls, 0),
    unsupportedValues:
      withVerdict.length === 0
        ? undefined
        : withVerdict.reduce((n, s) => n + (s.unsupportedValues ?? 0), 0),
  };
}

// ─── The declared neighbourhood ────────────────────────────────────────

function kindOf(spec: OntologySpec, id: string): 'term' | 'source' | undefined {
  if (Object.prototype.hasOwnProperty.call(spec.nodes, id)) return 'term';
  if (Object.prototype.hasOwnProperty.call(spec.sources, id)) return 'source';
  return undefined;
}

/**
 * Every declared id one step from the gap, in declaration order, no repeats:
 * for a term — the sources holding it, the tools reading it, the terms at
 * either end of a relation with it; for a source — the terms it holds and
 * the tools reading through it. Tools are ids here too: a tool name is a
 * declared string the answer can quote.
 */
function neighboursOf(spec: OntologySpec, gap: string, kind: 'term' | 'source'): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (id !== gap && !out.includes(id)) out.push(id);
  };
  if (kind === 'term') {
    for (const held of spec.nodes[gap]?.sources ?? []) {
      add(held.source);
      for (const tool of held.via ?? []) add(tool);
    }
    for (const edge of spec.edges ?? []) {
      if (edge.from === gap) add(edge.to);
      if (edge.to === gap) add(edge.from);
    }
  } else {
    for (const [id, node] of Object.entries(spec.nodes)) {
      for (const held of node.sources ?? []) {
        if (held.source !== gap) continue;
        add(id);
        for (const tool of held.via ?? []) add(tool);
      }
    }
  }
  return out;
}

/** The strings that name one declared id: a term's or a source's id and aliases; a tool's bare name. */
function namesOf(spec: OntologySpec, id: string): readonly string[] {
  const has = (o: object) => Object.prototype.hasOwnProperty.call(o, id);
  const declared = has(spec.nodes)
    ? spec.nodes[id]
    : has(spec.sources)
    ? spec.sources[id]
    : undefined;
  return declared === undefined ? [id] : [id, ...(declared.aliases ?? [])];
}

// ─── Matching — declared strings, whole word, nothing fuzzier ─────────

function mentions(answer: string, names: readonly string[]): boolean {
  return names.some((name) => patternOf(name).test(answer));
}

/**
 * One declared string as a whole-word, case-insensitive pattern; an `_` in
 * the id stands for a space, a hyphen or itself, so `vmkernel_log` meets
 * "vmkernel log" and `esxi_host` meets "ESXi host". Everything else is
 * escaped: a declared string is matched as itself.
 */
function patternOf(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[ _-]');
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i');
}

function wordsOf(answer: string): string[] {
  const found: string[] = [];
  for (const re of MAP_WORDS) {
    for (const m of answer.matchAll(re)) {
      const word = m[0].toLowerCase();
      if (!found.includes(word)) found.push(word);
    }
  }
  return found;
}
