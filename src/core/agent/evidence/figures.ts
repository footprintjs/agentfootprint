/**
 * figures — a number wearing a unit is data, and a number no result carried
 * is asked whether it DERIVES from the numbers one did, before it is flagged.
 *
 * Pattern: two pure folds — over the answer's text (`figureNumbersOf`) and
 *          over the tool results (`figureBasisOf`) — and one question
 *          (`explainFigure`). Deterministic arithmetic, no model.
 * Role:    core/ layer, `namesAndNumbersFromEvidence({ figures: true })` only.
 *          Off, nothing here runs and the gate is byte-identical.
 * Emits:   N/A.
 *
 * ## The hole this closes
 *
 * "How full is the cluster?" — a small model answered "53.2% used, 6.3 TB
 * free" and, on a second run, "64.5% used, 24.8 TB usable". The tool's rows
 * said 61.1% / 435.5 TB and 57.7% / 1,090.8 TB; neither answer's figures are
 * anywhere in them. The gate passed both answers CLEAN: `53.2`, `6.3`, `64.5`
 * and `24.8` have under `minDigits` (4) digits, so the extractor read them as
 * prose ("3 issues", "24 hours") and never looked them up. The bias is right
 * for a count in a sentence and wrong for a MEASUREMENT: a number with a unit
 * of measure stuck to it is a reading off a screen, whatever its length.
 *
 * And the reverse: the honest answer to the same question is a CLUSTER total
 * — "1,526.3 TB usable" — which is a sum, and appears in no result. The gate
 * flagged it as invented. A derived figure is neither read nor invented.
 *
 * ## The rule
 *
 * 1. **A figure is a number wearing a unit** (`FIGURE_UNITS`: `%`, `percent`,
 *    byte sizes, IOPS, throughput, `ms`/`us`), glued or one space apart. It is
 *    a candidate whatever its digit count. A whole number with no unit stays
 *    under `minDigits`' rule.
 * 2. **A number no result carried is asked for a derivation** — the closed set
 *    `FigureDerivation`, each over numbers the results DID carry, compared at
 *    the answer's own precision (`61%` matches 61.1; `61.0%` does not):
 *      • `rounded`            — a carried number, rounded;
 *      • `unit-scale`         — a carried number ÷ 1000^k or 1024^k (k = 1…5):
 *                                bytes stated as TB/TiB;
 *      • `column-sum`         — the sum of one numeric field over the rows of
 *                                one list (an array of objects, or a map of
 *                                objects), or over the rows sharing one value
 *                                of a text field (`cluster = A`); also scaled;
 *      • `column-ratio`       — 100 × one column sum ÷ another, both fields
 *                                wearing the same unit suffix (`used_tb` /
 *                                `total_tb`) — a percentage of totals;
 *      • `column-difference`  — one like-unit column sum minus another
 *                                (`total_tb` − `used_tb`), when positive;
 *      • `complement`         — 100 − a carried percentage (a field whose name
 *                                ends in `pct`/`percent`) or 100 − a ratio
 *                                above.
 *    A number that is one of these is COMPUTED (`EvidenceVerdict.computed`,
 *    with the derivation named); one that is none of them is UNSUPPORTED, and
 *    the sentences say so: no value, and no derivation.
 *
 * ## What it is not
 *
 * Not proof the arithmetic answered the question: "59.2% used" is accepted
 * as the ratio of two columns even if the person asked about one pool. Not
 * open-ended: a product, an average, a chain of two derivations, or a sum
 * over an arbitrary subset of rows is not reconstructed and is flagged — the
 * set is closed on purpose, because every derivation added is a window an
 * invented number can fall through by coincidence. The coincidence is real
 * and bounded by precision: a whole-number figure matches anything within
 * ±0.5 of it, a one-decimal figure ±0.05. The basis is bounded too
 * (`MAX_BASIS_NUMBERS`, `MAX_DERIVED`); past a bound the remaining numbers
 * are not asked about, which can only flag MORE, never fewer.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import { LIBRARY_NOTE_OPENING } from '../../../lib/saidByPerson.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import { readResult } from './evidenceIndex.js';
import { normalizeToken, tokenize } from './normalize.js';
import type { FigureDerivation, UnsupportedValue } from './types.js';

/** Units that make a number a figure. Lower-case; `/s` may follow a size. */
export const FIGURE_UNITS: readonly string[] = [
  '%',
  'percent',
  'kb',
  'mb',
  'gb',
  'tb',
  'pb',
  'kib',
  'mib',
  'gib',
  'tib',
  'pib',
  'iops',
  'mbps',
  'gbps',
  'ms',
  'us',
];

/** A number (thousands separators allowed) followed, glued or one space apart, by a unit. */
const FIGURE_RE = new RegExp(
  String.raw`(?<![\w.,])([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s?(%|(?:` +
    FIGURE_UNITS.filter((u) => u !== '%').join('|') +
    String.raw`)(?:\/s)?(?![a-z0-9]))`,
  'gi',
);

/** How many carried numbers the basis keeps. */
export const MAX_BASIS_NUMBERS = 50_000;
/** How many column-derived values (sums, ratios, differences, complements) the basis keeps. */
export const MAX_DERIVED = 50_000;
/** Rows per list, fields per list and groups per text field the basis reads. */
const MAX_ROWS = 5_000;
const MAX_FIELDS = 64;
const MAX_GROUPS = 50;
const MAX_GROUP_FIELDS = 8;

/** The normalized numbers the answer writes as figures (rule 1). */
export function figureNumbersOf(answer: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const m of answer.matchAll(FIGURE_RE)) {
    const n = normalizeToken(m[1] ?? '');
    if (n !== '') out.add(n);
  }
  return out;
}

/** One carried number, and where it was. */
interface Carried {
  readonly x: number;
  readonly at: string;
  /** The field it sat under, when it sat under one. */
  readonly key?: string;
}

/** One reconstructed value. */
interface Derived {
  readonly x: number;
  readonly derivation: FigureDerivation;
  readonly from: string;
}

/** What the results carry, folded for the derivation question. */
export interface FigureBasis {
  readonly carried: readonly Carried[];
  readonly derived: readonly Derived[];
  /** True when a bound cut the fold — some numbers were never asked about. */
  readonly truncated: boolean;
}

/** A finite number from a JSON leaf: a number, or a string that is one plain number. */
function numberOf(leaf: unknown): number | undefined {
  if (typeof leaf === 'number') return Number.isFinite(leaf) ? leaf : undefined;
  if (typeof leaf !== 'string') return undefined;
  const n = normalizeToken(leaf);
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(n)) return undefined;
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The unit suffix of a field name: after its last `_` or `-`, lower-cased. */
function unitOf(field: string): string | undefined {
  const m = /[_-]([A-Za-z]+)$/.exec(field);
  return m?.[1]?.toLowerCase();
}

const PERCENT_FIELD = /(?:pct|percent|percentage)$/i;

/** Rows of a list: an array whose elements are objects, or a map whose values are. */
function rowsOf(node: unknown): readonly Record<string, unknown>[] | undefined {
  if (Array.isArray(node)) {
    if (node.length === 0 || !node.every(isPlainObject)) return undefined;
    return node.slice(0, MAX_ROWS) as Record<string, unknown>[];
  }
  if (isPlainObject(node)) {
    const values = Object.values(node);
    if (values.length < 2 || !values.every(isPlainObject)) return undefined;
    return values.slice(0, MAX_ROWS) as Record<string, unknown>[];
  }
  return undefined;
}

class Fold {
  readonly carried: Carried[] = [];
  readonly derived: Derived[] = [];
  truncated = false;

  addCarried(c: Carried): void {
    if (this.carried.length >= MAX_BASIS_NUMBERS) {
      this.truncated = true;
      return;
    }
    this.carried.push(c);
  }

  addDerived(d: Derived): void {
    if (!Number.isFinite(d.x)) return;
    if (this.derived.length >= MAX_DERIVED) {
      this.truncated = true;
      return;
    }
    this.derived.push(d);
  }

  walk(node: unknown, at: string, key?: string): void {
    const x = numberOf(node);
    if (x !== undefined) {
      this.addCarried({ x, at, ...(key !== undefined && { key }) });
      return;
    }
    if (typeof node === 'string') {
      // A sentence inside a JSON leaf: its numbers are carried too.
      for (const t of tokenize(node)) {
        const n = numberOf(t);
        if (n !== undefined) this.addCarried({ x: n, at });
      }
      return;
    }
    const rows = rowsOf(node);
    if (rows !== undefined) this.columns(rows, at);
    if (Array.isArray(node)) {
      node.forEach((el, i) => this.walk(el, `${at}[${i}]`));
    } else if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) this.walk(v, at === '' ? k : `${at}.${k}`, k);
    }
  }

  /** The column derivations of one list. */
  columns(rows: readonly Record<string, unknown>[], at: string): void {
    const numeric = new Map<string, number[]>();
    const text = new Map<string, Set<string>>();
    for (const row of rows) {
      for (const [field, v] of Object.entries(row)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (!numeric.has(field) && numeric.size >= MAX_FIELDS) continue;
          const list = numeric.get(field);
          if (list === undefined) numeric.set(field, [v]);
          else list.push(v);
        } else if (typeof v === 'string' && v !== '') {
          const seen = text.get(field);
          if (seen === undefined) text.set(field, new Set([v]));
          else seen.add(v);
        }
      }
    }
    const name = at === '' ? 'result' : at;
    this.sums(rows, numeric, `${name}[]`);
    let groupFields = 0;
    for (const [field, values] of text) {
      if (values.size < 2 || values.size > MAX_GROUPS || values.size >= rows.length) continue;
      if (groupFields++ >= MAX_GROUP_FIELDS) break;
      for (const value of values) {
        const members = rows.filter((r) => r[field] === value);
        const cols = new Map<string, number[]>();
        for (const f of numeric.keys()) {
          cols.set(
            f,
            members.flatMap((r) =>
              typeof r[f] === 'number' && Number.isFinite(r[f]) ? [r[f] as number] : [],
            ),
          );
        }
        this.sums(members, cols, `${name}[${field}=${value}]`);
      }
    }
  }

  /** Sums of each field over `rows`, and the like-unit ratios, differences and complements. */
  sums(
    rows: readonly Record<string, unknown>[],
    numeric: ReadonlyMap<string, readonly number[]>,
    label: string,
  ): void {
    const totals = new Map<string, number>();
    for (const [field, values] of numeric) {
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      totals.set(field, sum);
      // A one-row sum is the value itself — already carried.
      if (rows.length > 1) {
        this.addDerived({ x: sum, derivation: 'column-sum', from: `sum of ${label}.${field}` });
      }
    }
    for (const [a, sa] of totals) {
      const ua = unitOf(a);
      if (ua === undefined || PERCENT_FIELD.test(a)) continue;
      for (const [b, sb] of totals) {
        if (a === b || unitOf(b) !== ua || PERCENT_FIELD.test(b)) continue;
        if (sb !== 0) {
          const ratio = (100 * sa) / sb;
          const what = `100 × ${label}.${a} ÷ ${label}.${b}`;
          this.addDerived({ x: ratio, derivation: 'column-ratio', from: what });
          if (ratio >= 0 && ratio <= 100) {
            this.addDerived({ x: 100 - ratio, derivation: 'complement', from: `100 − (${what})` });
          }
        }
        if (sb - sa > 0) {
          this.addDerived({
            x: sb - sa,
            derivation: 'column-difference',
            from: `${label}.${b} − ${label}.${a}`,
          });
        }
      }
    }
  }
}

// FOLD · the numbers this run's tool results carry, for the derivation question
// consumers read this and never re-derive it: gate.ts · checkAnswer, handed it by stages/route.ts · judgeEvidence
// detached: yes — never stored; rebuilt per judgement, and the verdict is committed as plain data.
/**
 * Fold every `role: 'tool'` message in `history` (the same messages, read the
 * same way, as the evidence corpus — `evidenceIndex.ts` · `readResult` over
 * `lib/toolBytes.ts` · `toolBytesOf`) into the numbers they carry and the
 * column derivations over their lists.
 */
export function figureBasisOf(history: readonly LLMMessage[]): FigureBasis {
  const fold = new Fold();
  for (const msg of history) {
    if (msg.role !== 'tool') continue;
    const read = readResult(toolBytesOf(msg));
    if ('text' in read) {
      fold.walk(read.text, '');
      continue;
    }
    fold.walk(read.parsed, '');
    if (read.tail !== undefined) fold.walk(read.tail, '');
  }
  return { carried: fold.carried, derived: fold.derived, truncated: fold.truncated };
}

/** What the gate is handed under the dial: built once per judgement. */
export interface FigureCheck {
  /** The normalized numbers the answer writes as figures (rule 1). */
  readonly numbers: ReadonlySet<string>;
  /** The derivation question over the results' numbers (rule 2). */
  readonly explain: (
    value: string,
  ) => { readonly derivation: FigureDerivation; readonly from: string } | undefined;
}

/**
 * The gate's figures input for one judgement — the answer's figures and the
 * results' basis. This module loads through `import()` under the dial only
 * (`stages/route.ts` · `loadFigures`), so a plain agent's graph never carries it.
 */
export function figureCheckOf(answer: string, history: readonly LLMMessage[]): FigureCheck {
  const basis = figureBasisOf(history);
  return { numbers: figureNumbersOf(answer), explain: (value) => explainFigure(value, basis) };
}

/** Decimal places the answer wrote the value with. */
function decimalsOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

/** True when `x`, rounded to `decimals` places, is `f` (half-unit window, inclusive). */
function roundsTo(x: number, f: number, decimals: number): boolean {
  const half = 0.5 * 10 ** -decimals;
  return Math.abs(x - f) <= half * (1 + 1e-9) + 1e-12;
}

const SCALES: readonly { readonly by: number; readonly label: string }[] = [1, 2, 3, 4, 5].flatMap(
  (k) => [
    { by: 1000 ** k, label: `1000^${k}` },
    { by: 1024 ** k, label: `1024^${k}` },
  ],
);

/** Format a carried number for a `from` string. */
function shown(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(12)));
}

/**
 * Is `value` (a normalized number from the answer) a declared derivation of
 * the numbers in `basis`? The first derivation found, or `undefined`. Order:
 * rounded, unit-scale, then the column derivations (sum, ratio, difference,
 * complement) — each also unit-scaled for a sum.
 */
export function explainFigure(
  value: string,
  basis: FigureBasis,
): { readonly derivation: FigureDerivation; readonly from: string } | undefined {
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(value)) return undefined;
  const f = Number(value);
  if (!Number.isFinite(f)) return undefined;
  const d = decimalsOf(value);
  for (const c of basis.carried) {
    if (roundsTo(c.x, f, d)) return { derivation: 'rounded', from: `${shown(c.x)} at ${c.at}` };
  }
  for (const c of basis.carried) {
    if (Math.abs(c.x) < 1000) continue;
    for (const s of SCALES) {
      if (roundsTo(c.x / s.by, f, d)) {
        return { derivation: 'unit-scale', from: `${shown(c.x)} at ${c.at} ÷ ${s.label}` };
      }
    }
  }
  for (const c of basis.carried) {
    if (c.key !== undefined && PERCENT_FIELD.test(c.key) && roundsTo(100 - c.x, f, d)) {
      return { derivation: 'complement', from: `100 − ${shown(c.x)} at ${c.at}` };
    }
  }
  for (const r of basis.derived) {
    if (roundsTo(r.x, f, d)) return { derivation: r.derivation, from: r.from };
  }
  for (const r of basis.derived) {
    if (r.derivation !== 'column-sum' || Math.abs(r.x) < 1000) continue;
    for (const s of SCALES) {
      if (roundsTo(r.x / s.by, f, d)) {
        return { derivation: 'unit-scale', from: `(${r.from}) ÷ ${s.label}` };
      }
    }
  }
  return undefined;
}

/**
 * WHO says the late line — the library, not the person — in the exact words
 * the time line measured (`arguments/serve.ts` · `TIME_LINE_SOURCE`: an
 * unmarked request-only `user` line drew "You're right… I apologize" on 37 of
 * 37 answers). Both are the ONE copy in the authorship registry
 * (`lib/saidByPerson.ts`, a zero-import leaf — so this folder still never
 * loads the time layer's module graph), which is what makes `isSaidByPerson`
 * false for this line (G17).
 */
export { LIBRARY_NOTE_OPENING };

/** How many flagged numbers the late line names. */
const MAX_CONCLUSION_VALUES = 8;

// LENS · request-only · this-call
// reads: the flagged values the recheck stage HANDS it, never the corpus
// law: may omit, never deny; it states what the check found, never what the data says.
/**
 * The library's conclusion about the numbers it flagged under the figures
 * dial, as ONE line for the end of the revision request. `undefined` when no
 * flagged value is a number (an identifier is not a figure; its correction
 * is the instruction alone).
 *
 * Why a late line and not one more clause in the instruction: the instruction
 * sits in the system prompt, the top of a long context; the measured failure
 * of a served fact is recency (a library fact served late moved a bench from
 * 74 to 20 of 80), so the conclusion goes where the model decides. Worded as
 * the framework's finding — never as the person's correction, which a model
 * thanks and apologises to. It names the draft's own flagged numbers, which
 * the instruction already quotes, and tells the model not to state them.
 */
export function figuresConclusionLine(values: readonly UnsupportedValue[]): string | undefined {
  const numbers = values.filter((v) => v.shape === 'figure' || v.shape === 'number');
  if (numbers.length === 0) return undefined;
  const shown = numbers.slice(0, MAX_CONCLUSION_VALUES).map((v) => v.value);
  const more = numbers.length - shown.length;
  return (
    LIBRARY_NOTE_OPENING +
    ` The evidence check: these numbers in your draft appear in no tool result, and none is a rounding, sum, ` +
    `ratio, difference or unit conversion of the numbers the results carry: ` +
    `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}. ` +
    'Do not state them. State a figure only as a tool result gives it, or compute it with a ' +
    'tool; if no result in front of you shows the figure asked for, say that plainly instead ' +
    'of estimating.'
  );
}
