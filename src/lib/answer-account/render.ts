/**
 * Fill and grammar — how a template id and its vars become a typed sentence.
 *
 * `fillParts` substitutes placeholders NON-recursively (the `renderCommentary`
 * precedent): a var's value is never read as a template, so a tool that
 * declares "{{x}}" in its own words gets "{{x}}" printed, not substituted.
 * A missing var is a programming error and throws — `account.ts` catches it
 * per sentence and writes `unreadable.line@1` instead.
 *
 * English-only surfaces (named for the later locale map): the `count` pairs
 * inside the table, `allOf`, `joinAnd`, `distance` (all table-driven except
 * `joinAnd`'s ", " / " and ").
 */

import { ANSWER_ACCOUNT_TEMPLATES, type TemplateId } from './templates.js';
import { answerAccountPointerKey as pointerKey } from './pointerKey.js';
import type {
  AccountSource,
  Chip,
  ChipMark,
  FactStatus,
  MissingReason,
  RecordPointer,
  Sentence,
  SentencePart,
  SentenceVar,
} from './types.js';

/** Pointers one sentence carries at most (its printed vars' leaves come first). */
export const MAX_POINTERS = 12;

/** A string var longer than this is clipped, with `part.clipped@1` after it. */
export const MAX_VAR_CHARS = 2000;

type Vars = Readonly<Record<string, SentenceVar>>;

// ── voucher ranking ──────────────────────────────────────────────────────

const RANK: Readonly<Record<string, number>> = { person: 0, library: 1, tool: 2, model: 3, app: 4 };

const rankOf = (source: AccountSource): number =>
  RANK[source.startsWith('tool:') ? 'tool' : source] ?? 4;

/** The weakest of the given sources (library > tool > model > app; person strongest). */
export function weakest(sources: readonly AccountSource[]): AccountSource {
  let out: AccountSource = 'person';
  for (const s of sources) if (rankOf(s) > rankOf(out)) out = s;
  return out;
}

/** A var is presentation, not truth, when it is a skill's LABEL (`<name>Label`). */
export const isPresentationVar = (name: string): boolean => name.endsWith('Label');

// ── vars ─────────────────────────────────────────────────────────────────

/** A var read from the record (or a declaration). Long strings are clipped. */
export function v(
  value: string | number,
  source: AccountSource,
  from?: RecordPointer,
  max: number = MAX_VAR_CHARS,
): SentenceVar {
  const clipped = typeof value === 'string' && value.length > max;
  return {
    value: clipped ? (value as string).slice(0, max) : value,
    source,
    ...(from !== undefined && { from }),
    ...(clipped && { clipped: true as const }),
  };
}

/** A fact's text value, cut at `max` characters with `clipped: true` — the size bound. */
export function clipFact(value: string, max: number): { value: string; clipped?: true } {
  return value.length > max ? { value: value.slice(0, max), clipped: true } : { value };
}

/** A number the account computed (a count) — no pointer of its own. */
export const n = (value: number, source: AccountSource = 'library'): SentenceVar => ({
  value,
  source,
});

// ── fill ─────────────────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{([^}]+)\}\}/g;

function varOf(vars: Vars, name: string, id: string): SentenceVar {
  const found = vars[name];
  if (found === undefined) throw new Error(`answer-account: template ${id} needs var "${name}"`);
  return found;
}

function numberOf(vars: Vars, name: string, id: string): number {
  const value = varOf(vars, name, id).value;
  if (typeof value !== 'number')
    throw new Error(`answer-account: var "${name}" of ${id} is not a number`);
  return value;
}

const countWords = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** "n one" / "n many" — an explicit pair, never a suffix. */
export const count = countWords;

/** "was" / "were" by count. */
export const verb = (count: number, one: string, many: string): string =>
  count === 1 ? one : many;

/** ≤ 3 values inline: "a", "a and b", "a, b and c". Longer lists are the caller's bulleted list. */
export function joinAnd(values: readonly string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function textOf(id: TemplateId, vars: Vars): { text: string; parts: SentencePart[] } {
  return fillParts(id, vars);
}

function expandPlaceholder(body: string, vars: Vars, id: string): SentencePart[] {
  const countMatch = /^count:([A-Za-z0-9_]+),'([^']*)','([^']*)'$/.exec(body);
  if (countMatch) {
    const [, name = '', one = '', many = ''] = countMatch;
    return [{ text: countWords(numberOf(vars, name, id), one, many) }];
  }
  const allOfMatch = /^allOf:([A-Za-z0-9_]+)$/.exec(body);
  if (allOfMatch) {
    const k = numberOf(vars, allOfMatch[1] ?? '', id);
    if (k === 1) return fillParts('part.allOf.one', {}).parts;
    if (k === 2) return fillParts('part.allOf.two', {}).parts;
    return fillParts('part.allOf.many', { n: n(k) }).parts;
  }
  const [name, kind] = body.split(':') as [string, string | undefined];
  const variable = varOf(vars, name, id);
  const value = String(variable.value);
  const clippedTail: SentencePart[] = variable.clipped ? fillParts('part.clipped', {}).parts : [];
  switch (kind) {
    case undefined:
      return [{ text: value }, ...clippedTail];
    case 'code':
      return [{ code: value }, ...clippedTail];
    case 'quote':
      return [{ quote: value, source: variable.source }, ...clippedTail];
    case 'label':
      return [{ label: value, source: variable.source }, ...clippedTail];
    case 'skill': {
      const label = vars[`${name}Label`];
      return label === undefined
        ? fillParts('part.skill.bare', { id: variable }).parts
        : fillParts('part.skill.labelled', { id: variable, label }).parts;
    }
    case 'distance': {
      const distance = numberOf(vars, name, id);
      const windowed = vars[`${name}Windowed`]?.value === 1;
      if (windowed) return fillParts('distance.atLeast', { n: n(distance) }).parts;
      if (distance === 1) return fillParts('distance.previous', {}).parts;
      return fillParts('distance.back', { n: n(distance) }).parts;
    }
    default:
      throw new Error(`answer-account: unknown placeholder kind "${kind}" in ${id}`);
  }
}

function mergeText(parts: readonly SentencePart[]): SentencePart[] {
  const out: SentencePart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if ('text' in part && last !== undefined && 'text' in last) {
      out[out.length - 1] = { text: last.text + part.text };
    } else if (!('text' in part) || part.text.length > 0) {
      out.push(part);
    }
  }
  return out;
}

const partText = (part: SentencePart): string =>
  'text' in part
    ? part.text
    : 'code' in part
    ? part.code
    : 'quote' in part
    ? part.quote
    : part.label;

/**
 * Fill one template. Returns the plain text and the same text as typed parts.
 * Throws on a missing var or an unknown placeholder kind (a programming error).
 */
export function fillParts(id: TemplateId, vars: Vars): { text: string; parts: SentencePart[] } {
  const template = ANSWER_ACCOUNT_TEMPLATES[id];
  if (template === undefined) throw new Error(`answer-account: unknown template ${String(id)}`);
  const raw: SentencePart[] = [];
  let at = 0;
  for (const match of template.text.matchAll(PLACEHOLDER)) {
    raw.push({ text: template.text.slice(at, match.index) });
    raw.push(...expandPlaceholder(match[1] ?? '', vars, id));
    at = (match.index ?? 0) + match[0].length;
  }
  raw.push({ text: template.text.slice(at) });
  const parts = mergeText(raw);
  return { text: parts.map(partText).join(''), parts };
}

// ── sentences and chips ──────────────────────────────────────────────────

export interface SentenceSpec {
  readonly vars?: Vars;
  readonly pointers?: readonly RecordPointer[];
  /** Sources that decide the sentence's truth but are not printed (e.g. the `rowsAt` that made a result "empty"). */
  readonly basis?: readonly AccountSource[];
  readonly status?: FactStatus;
  readonly missing?: MissingReason;
  readonly chips?: readonly Chip[];
  readonly item?: true;
}

/** The template's own voucher, resolved (`tool` → `tool:<the tool var's value>`). */
function voucherOf(id: TemplateId, vars: Vars): AccountSource {
  const voucher = ANSWER_ACCOUNT_TEMPLATES[id].voucher;
  if (voucher !== 'tool') return voucher;
  // The tool NAME is recorded by the library; the CLAIM is the tool's own.
  return `tool:${String(varOf(vars, 'tool', id).value)}`;
}

/** The weakest-voucher rule over a sentence's inputs (labels excluded — presentation). */
export function sentenceSource(
  id: TemplateId,
  vars: Vars,
  basis: readonly AccountSource[] = [],
): AccountSource {
  const truth = Object.entries(vars)
    .filter(([name]) => !isPresentationVar(name))
    .map(([, variable]) => variable.source);
  return weakest([voucherOf(id, vars), ...truth, ...basis]);
}

/** Build one sentence. Throws only on a programming error (see `fillParts`). */
export function sentence(id: TemplateId, spec: SentenceSpec = {}): Sentence {
  const vars = spec.vars ?? {};
  const { text, parts } = textOf(id, vars);
  const template = ANSWER_ACCOUNT_TEMPLATES[id];
  // The vars' own pointers first (each one is a leaf the sentence printed), then the
  // sentence's evidence — capped: a sentence about 3,000 rows points at a sample of them.
  const pointers = dedupePointers([
    ...Object.values(vars).flatMap((variable) => (variable.from ? [variable.from] : [])),
    ...(spec.pointers ?? []),
  ]).slice(0, MAX_POINTERS);
  return {
    text,
    parts,
    template: { id, version: template.version },
    vars,
    source: sentenceSource(id, vars, spec.basis),
    status: spec.status ?? 'recorded',
    pointers,
    ...(spec.missing !== undefined && { missing: spec.missing }),
    ...(spec.chips !== undefined && spec.chips.length > 0 && { chips: spec.chips }),
    ...(spec.item === true && { item: true as const }),
  };
}

/** A fixed-word chip. */
export function chip(
  mark: ChipMark,
  id: TemplateId,
  tone: Chip['tone'] = 'plain',
  vars: Vars = {},
): Chip {
  return {
    mark,
    text: fillParts(id, vars).text,
    tone,
    template: { id, version: ANSWER_ACCOUNT_TEMPLATES[id].version },
  };
}

/** "said by: …" for one source. */
export function saidBy(source: AccountSource): Chip {
  const who =
    source === 'person'
      ? fillParts('chip.who.person', {}).text
      : source === 'library'
      ? fillParts('chip.who.library', {}).text
      : source === 'model'
      ? fillParts('chip.who.model', {}).text
      : source === 'app'
      ? fillParts('chip.who.app', {}).text
      : source.slice('tool:'.length);
  return chip('said-by', 'chip.saidBy', 'plain', { who: { value: who, source: 'library' } });
}

/** A stable identity for a pointer — the `shown` map's key (owned by `./pointerKey.ts`). */
export { pointerKey };

export function dedupePointers(pointers: readonly RecordPointer[]): RecordPointer[] {
  const seen = new Set<string>();
  const out: RecordPointer[] = [];
  for (const p of pointers) {
    const key = pointerKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Two signal sentences as one line (`summary.signals@1`): the parts of both,
 * the vars of both (prefixed), the weakest voucher of both.
 */
export function joinSentences(first: Sentence, second?: Sentence): Sentence {
  const id: TemplateId = second === undefined ? 'summary.signal' : 'summary.signals';
  const template = ANSWER_ACCOUNT_TEMPLATES[id];
  const prefixed = (s: Sentence, prefix: string): Record<string, SentenceVar> =>
    Object.fromEntries(Object.entries(s.vars).map(([k, value]) => [`${prefix}.${k}`, value]));
  const parts =
    second === undefined
      ? first.parts
      : mergeText([...first.parts, { text: ' ' }, ...second.parts]);
  return {
    text: second === undefined ? first.text : `${first.text} ${second.text}`,
    parts,
    template: { id, version: template.version },
    vars: { ...prefixed(first, 'first'), ...(second ? prefixed(second, 'second') : {}) },
    source: weakest([first.source, ...(second ? [second.source] : [])]),
    status: first.status,
    pointers: dedupePointers([...first.pointers, ...(second?.pointers ?? [])]),
  };
}
