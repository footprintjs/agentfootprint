/**
 * What every row reader shares: the view, the declarations, the per-sentence
 * catch, and the small pointer / var builders.
 *
 * `say` is THE way a reader writes a line. It fills the template and, when the
 * fill throws (a programming error — a var the reader forgot), writes
 * `unreadable.line@1` instead and counts it in `unread`. One bad line never
 * crashes the account.
 */

import { readAbsence } from '../../../core/agent/coverage/absent.js';
import { sentence, v, type SentenceSpec } from '../render.js';
import type { TemplateId } from '../templates.js';
import type {
  AccountSource,
  AnswerAccountDeclarations,
  Emptiness,
  RecordPointer,
  Sentence,
  SentenceVar,
} from '../types.js';
import { isRecord, str, type RecordingView, type ViewEvent } from '../view.js';

export interface ReadContext {
  readonly view: RecordingView;
  readonly declarations: AnswerAccountDeclarations;
  /** A resumed leg: a `pause.resume`, or a `turn_end` with no `turn_start`. */
  readonly resumedLeg: boolean;
  /** The iteration of the last `stream.llm_start` before `turn_end` (the answering iteration). */
  readonly answeringIteration?: number;
  /** Write one line through the per-sentence catch. */
  say(id: TemplateId, spec?: SentenceSpec): Sentence;
  /** Count one row the account passed over because its shape did not fit. */
  noteUnread(): void;
  /** Items (and their characters) already printed — the account's size bound. */
  readonly budget: { itemChars: number; items: number };
}

/**
 * The bulleted items the account prints IN TOTAL — declared coverage items and
 * flagged values. Each item rides a sentence (its text three times: `text`,
 * `parts`, `vars`, plus pointers, about 1 KB of structure), so both the count
 * and the characters are bounded; past either, items fold into `items.more@1`
 * and the account stays under 128 KB by construction.
 */
export const ITEM_BUDGET = { items: 12, chars: 3_000 } as const;

/** Take one item of `chars` characters from the budget; `false` = fold it. */
export function takeItem(ctx: ReadContext, chars: number): boolean {
  if (ctx.budget.items + 1 > ITEM_BUDGET.items || ctx.budget.itemChars + chars > ITEM_BUDGET.chars)
    return false;
  ctx.budget.items += 1;
  ctx.budget.itemChars += chars;
  return true;
}

/** @internal — a test hook: force the fill of one template id to throw. */
export interface AccountInternals {
  readonly failTemplate?: string;
}

/**
 * Long text the account prints in TOTAL, past the first `SHORT_TEXT_CHARS` of
 * each value: once spent, every later value is cut at `SHORT_TEXT_CHARS` (marked
 * `clipped`, followed by `part.clipped@1`). With the item budget it keeps the
 * account under 128 KB by construction.
 */
export const LONG_TEXT_BUDGET = 3_000;
export const SHORT_TEXT_CHARS = 300;

function spendText(
  vars: Readonly<Record<string, SentenceVar>>,
  budget: { longChars: number },
): Record<string, SentenceVar> {
  const out: Record<string, SentenceVar> = {};
  for (const [name, variable] of Object.entries(vars)) {
    const text = variable.value;
    if (typeof text !== 'string' || text.length <= SHORT_TEXT_CHARS) {
      out[name] = variable;
      continue;
    }
    const allowed = Math.min(
      text.length,
      SHORT_TEXT_CHARS + Math.max(0, LONG_TEXT_BUDGET - budget.longChars),
    );
    budget.longChars += allowed - SHORT_TEXT_CHARS;
    out[name] =
      allowed >= text.length
        ? variable
        : { ...variable, value: text.slice(0, allowed), clipped: true as const };
  }
  return out;
}

export function makeSay(
  internals: AccountInternals | undefined,
  onUnread: () => void,
  budget: { longChars: number } = { longChars: 0 },
): (id: TemplateId, spec?: SentenceSpec) => Sentence {
  return (id, spec = {}) => {
    try {
      if (internals?.failTemplate === id) throw new Error(`forced failure of ${id}`);
      return sentence(
        id,
        spec.vars === undefined ? spec : { ...spec, vars: spendText(spec.vars, budget) },
      );
    } catch {
      onUnread();
      return sentence('unreadable.line', {
        status: 'not-recorded',
        missing: 'unreadable',
        pointers: spec.pointers ?? [],
        vars: {},
      });
    }
  };
}

// ── pointers ─────────────────────────────────────────────────────────────

/** RFC 6901: escape `~` and `/` in one segment. */
const segment = (key: string | number): string =>
  String(key).replace(/~/g, '~0').replace(/\//g, '~1');

export const jsonPointer = (...keys: readonly (string | number)[]): string =>
  keys.map((k) => `/${segment(k)}`).join('');

export function at(event: ViewEvent, ...keys: readonly (string | number)[]): RecordPointer {
  const runtimeStageId = str(event.meta.runtimeStageId);
  return {
    kind: 'event',
    index: event.index,
    type: event.type,
    path: jsonPointer(...keys),
    ...(runtimeStageId !== undefined && { runtimeStageId }),
  };
}

/** A derived leaf on an event (`#emptiness`, `#meta/runId`). */
export function derived(event: ViewEvent, path: string): RecordPointer {
  const runtimeStageId = str(event.meta.runtimeStageId);
  return {
    kind: 'event',
    index: event.index,
    type: event.type,
    path,
    ...(runtimeStageId !== undefined && { runtimeStageId }),
  };
}

export const stateAt = (key: string, ...keys: readonly (string | number)[]): RecordPointer => ({
  kind: 'state',
  key,
  path: jsonPointer(...keys),
});

export const historyAt = (index: number, path: string, toolCallId?: string): RecordPointer => ({
  kind: 'history',
  index,
  path,
  ...(toolCallId !== undefined && { toolCallId }),
});

export function declarationAt(
  declarations: AnswerAccountDeclarations,
  field: string,
): RecordPointer {
  return {
    kind: 'declaration',
    owner: 'app',
    field,
    ...(declarations.id !== undefined && { id: declarations.id }),
    ...(declarations.version !== undefined && { version: declarations.version }),
  };
}

// ── vars ─────────────────────────────────────────────────────────────────

/** A tool name the LIBRARY recorded (its claims are vouched by the template). */
export const toolVar = (name: string, from?: RecordPointer): SentenceVar =>
  v(name, 'library', from);

/**
 * The `{{name:skill}}` pair: the id (library) and, when there is one, its plain
 * label — the recorded `title` (library) or the app's declared label (app).
 */
export function skillVars(
  ctx: ReadContext,
  name: string,
  id: string,
  from?: RecordPointer,
): Record<string, SentenceVar> {
  const out: Record<string, SentenceVar> = { [name]: v(id, 'library', from) };
  const node = ctx.view.ofType('skill.graph_declared').flatMap((e) => {
    const nodes = Array.isArray(e.payload.nodes) ? e.payload.nodes : [];
    return nodes.flatMap((node, i) =>
      isRecord(node) && node.id === id && typeof node.title === 'string' && node.title.length > 0
        ? [{ title: node.title, pointer: at(e, 'nodes', i, 'title') }]
        : [],
    );
  })[0];
  if (node !== undefined) {
    out[`${name}Label`] = v(node.title, 'library', node.pointer);
    return out;
  }
  const label = ctx.declarations.skills?.[id]?.label;
  if (label !== undefined) {
    out[`${name}Label`] = v(label, 'app', declarationAt(ctx.declarations, `skills.${id}.label`));
  }
  return out;
}

// ── the model's view of a result ─────────────────────────────────────────

/** JSON text that is an object or array is read as data; anything else as found. */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

export interface EmptinessReading {
  readonly emptiness: Emptiness;
  readonly rows?: number;
  readonly source?: 'library' | 'app';
  /** The rows key the reading used (the app's `rowsAt`), when it used one. */
  readonly rowsAt?: string;
  /** An object result with no declared shape — the empty-results check cannot be run on it. */
  readonly undeclaredShape: boolean;
}

/**
 * Typed routes only (never a guess): a declared absence; a zero-length
 * top-level array (library-counted); an object whose app-declared `rowsAt`
 * key holds an array (app-counted). Anything else is `unknown`.
 */
export function readEmptiness(
  value: unknown,
  toolName: string,
  declarations: AnswerAccountDeclarations,
  declaredAbsent: boolean,
): EmptinessReading {
  const data = parseMaybeJson(value);
  if (declaredAbsent || readAbsence(data) !== undefined) {
    return { emptiness: 'declared-absent', undeclaredShape: false };
  }
  if (Array.isArray(data)) {
    return data.length === 0
      ? { emptiness: 'undeclared-empty', rows: 0, source: 'library', undeclaredShape: false }
      : { emptiness: 'non-empty', rows: data.length, source: 'library', undeclaredShape: false };
  }
  if (isRecord(data)) {
    const rowsAt = declarations.tools?.[toolName]?.rowsAt;
    const rows = rowsAt !== undefined ? data[rowsAt] : undefined;
    if (rowsAt !== undefined && Array.isArray(rows)) {
      return rows.length === 0
        ? { emptiness: 'undeclared-empty', rows: 0, source: 'app', rowsAt, undeclaredShape: false }
        : {
            emptiness: 'non-empty',
            rows: rows.length,
            source: 'app',
            rowsAt,
            undeclaredShape: false,
          };
    }
    return { emptiness: 'unknown', undeclaredShape: true };
  }
  return { emptiness: 'unknown', undeclaredShape: false };
}

/** The source a sentence's emptiness claim rests on. */
export const emptinessSource = (reading: { readonly source?: 'library' | 'app' }): AccountSource =>
  reading.source === 'app' ? 'app' : 'library';

/** `sharedState.history`, when it is an array. */
export function historyOf(view: RecordingView): readonly unknown[] {
  const history = view.state?.history;
  return Array.isArray(history) ? history : [];
}
