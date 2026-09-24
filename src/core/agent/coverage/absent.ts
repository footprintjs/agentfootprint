/**
 * absent — an absence that names its own coverage.
 *
 * Pattern: minted by a helper, RECOGNIZED by the framework (the tool-effects
 *          envelope precedent). A return shape the framework does not
 *          understand is a convention, and a convention cannot set a status,
 *          keep a value out of the evidence corpus, or stop a retry loop.
 * Role:    core/ layer, pure. The dispatch loop calls `readAbsence` at the
 *          execute boundary; `absent()` is what a tool author writes.
 * Emits:   N/A (the caller emits `agentfootprint.tools.absent`).
 *
 * ## The direction-of-error argument — the whole point of this file
 *
 * A tool that finds nothing returns *something*: an empty array, a `null`, a
 * sentence. From any of those a model cannot tell **"I looked and there is
 * nothing"** from **"I could not look"**. That confusion is not symmetric,
 * and the asymmetry is what makes it worth a primitive:
 *
 *   • a *nothing-found* misread as an *outage* sends someone to investigate a
 *     collector that is working perfectly — expensive, and self-correcting.
 *   • an *outage* misread as *nothing-found* declares a system healthy that
 *     was never checked — cheap, silent, and wrong in the direction that
 *     hurts.
 *
 * So the two must not share a shape. An error is a `role: 'tool'` result with
 * `error: true`, a message, and no coverage. An absence is this: a result
 * that RAN, carries the ground it covered, and says out loud that asking
 * again changes nothing.
 *
 * ## Why the note is never interpolated
 *
 * Tool results are the evidence gate's corpus, so an absence that echoed the
 * model's own arguments into that corpus would GROUND every identifier a model
 * invented, as long as it handed the invention to one tool that found nothing.
 * That is laundering an invention through a failed lookup — the same bug
 * `evidence/frames.ts` exists to stop on the other side of the conversation.
 *
 * The gate therefore withholds `looked_for`, and only `looked_for` (see
 * `coverage/evidence.ts`): it is the one field whose job is to quote the
 * request. Everything else the absence carries — the coverage lists, the
 * author's `tryInstead` and `tryInsteadTool`, any extra key the tool attached
 * to the envelope — is the TOOL speaking about the world and does ground,
 * because an answer that follows the absence's own advice must not be called
 * ungrounded for doing so.
 * The note is kept free of interpolation for the same reason the exclusion
 * exists: static library text has nothing of the caller's to leak.
 *
 * ## A suggestion to try another tool is typed, never parsed (9.113.0)
 *
 * `tryInstead` is ONE sentence, for the model; nothing in this library reads
 * a tool name out of it. When the sentence points at another tool, the author
 * names that tool beside it — `tryInsteadTool: { tool, why? }` — and the
 * envelope carries it under its OWN key, `try_instead_tool`. Its own key, not
 * `try_instead`: that field has been a string since it shipped and every
 * reader typed against `ToolAbsence` reads it as one, so a second shape there
 * would be dropped by each of them without a word. `tools.absent` carries
 * both, as declared. ONE rule set decides what each is ({@link readSentence},
 * {@link readToolSuggestion}): `absent()` refuses by it and the recognizer
 * reads by it, so a mint and a read cannot disagree.
 */

import { warnIfInvalidToolName } from '../../tools.js';
import { normalizeCoverageList } from './items.js';
import type { AbsenceDeclaration, Coverage, ToolAbsence, TryInsteadTool } from './types.js';

/**
 * The reserved key that makes an absence recognizable. Exported because tests,
 * docs and any consumer inspecting a raw tool result match on it — and
 * because a reserved word on the wire has to be nameable.
 */
export const ABSENCE_MARKER = 'af_absent';

/**
 * The static sentence every absence carries. Says the three things the field
 * implementation proved a model needs: that the call SUCCEEDED, that nothing
 * was substituted, and that a retry is futile. The third clause is the one
 * that ends the loop.
 */
export const ABSENCE_NOTE =
  'The search ran and matched nothing. This is an ANSWER, not an error: nothing failed, ' +
  'nothing was substituted for what was asked, and calling this tool again with the same ' +
  'arguments returns this same result. `checked` is the ground this answer covers; anything ' +
  'under `not_checked` or `cannot_cover` is ground it does NOT cover, and reaching that ' +
  'needs a different question, not a retry.';

/**
 * The typed tool's keys, tied to {@link TryInsteadTool} in BOTH directions: a
 * key the interface gains, or one listed here that it does not have, fails to
 * compile. Any other key on a value is refused, so a misspelt `why` cannot
 * vanish without a word.
 */
const TOOL_SUGGESTION_KEYS: readonly string[] = Object.keys({
  tool: true,
  why: true,
} satisfies Record<keyof TryInsteadTool, true>);

/**
 * What one suggestion field reads as. `value: undefined` with no `problem`
 * means "declared nothing" — the field omitted or `null`, or a sentence slot
 * holding a blank string or a value that is neither a string nor a plain
 * object: what the sentence form always did.
 */
type Reading<T> =
  | { readonly value: T | undefined; readonly problem?: undefined }
  | { readonly value?: undefined; readonly problem: string };

/**
 * `undefined` and `null` both mean "not given" for the typed tool and its
 * `why`. A JSON producer writes a missing optional value as `null`, and
 * `tryInstead: null` read as no suggestion before 9.113.0 — refusing it would
 * turn a nothing-found into a tool error, the direction of error this file
 * exists to prevent.
 */
const notGiven = (raw: unknown): boolean => raw === undefined || raw === null;

/** An object literal's shape — `{…}` or `Object.create(null)`; never an
 *  array, a Date, a boxed string or any other class instance. */
const isPlainObject = (raw: unknown): boolean => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const prototype: unknown = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
};

/**
 * The rule for the SENTENCE (`tryInstead`, `try_instead` on the wire):
 * trimmed, and one that trims to nothing is no suggestion, as it always was.
 *
 * ONE non-string is refused: a plain object. That is the typed form
 * `{ tool, why? }` written into the sentence's slot, and the refusal points it
 * at `tryInsteadTool` rather than drop the author's tool without a word. Any
 * OTHER value that is not a string — `null`, `false` from
 * `tryInstead: cond && '…'`, a number, a list, a Date — reads as no
 * suggestion, exactly as it did before 9.113.0: `absent()` runs inside a
 * tool's `execute`, so refusing it would turn a nothing-found the 9.112.2
 * loop delivered as an absence into that call's error result.
 */
function readSentence(raw: unknown): Reading<string> {
  if (typeof raw === 'string') {
    const sentence = raw.trim();
    return { value: sentence === '' ? undefined : sentence };
  }
  if (isPlainObject(raw)) {
    return {
      problem:
        '`tryInstead` is the sentence the model reads, and only that. To name the other ' +
        'tool as data, give { tool, why? } as `tryInsteadTool`, beside the sentence.',
    };
  }
  return { value: undefined };
}

/**
 * The rule for the TYPED TOOL (`tryInsteadTool`, `try_instead_tool` on the
 * wire): `{ tool, why? }`, where `tool` is a non-empty name and `why`, when
 * given, says something. Both are trimmed; `why: null` reads as omitted. The
 * name is recorded as declared: never looked up (a provider may serve it on a
 * later iteration), and held to no charset here — which names a provider
 * accepts is `core/tools.ts` · `assertValidToolName`'s question, and
 * `absent` asks the dev-mode warning that owns it.
 *
 * Why ONE tool and not a list: every suggestion on record names at most one
 * other tool, and where a sentence joins that tool to "or widen the window",
 * the rest of the advice stays in the sentence. A list would be a second
 * shape of this field for every reader to narrow — the cost this key exists
 * to spare `try_instead`.
 */
function readToolSuggestion(raw: unknown): Reading<TryInsteadTool> {
  if (notGiven(raw)) return { value: undefined };
  if (Array.isArray(raw)) {
    return {
      problem:
        '`tryInsteadTool` names ONE tool — { tool, why? }, never a list. Say the rest of the ' +
        'advice in the `tryInstead` sentence.',
    };
  }
  if (typeof raw !== 'object') {
    return {
      problem:
        `\`tryInsteadTool\` must be { tool, why? } — got ${typeof raw}. For a sentence, use ` +
        '`tryInstead`; to suggest nothing, omit the field.',
    };
  }
  const value = raw as { readonly tool?: unknown; readonly why?: unknown };
  const unknownKey = Object.keys(value).find((key) => !TOOL_SUGGESTION_KEYS.includes(key));
  if (unknownKey !== undefined) {
    return {
      problem:
        `\`tryInsteadTool\` has an unknown key '${unknownKey}' — the form is { tool, why? }, ` +
        'and a misspelt `why` would otherwise vanish without a word.',
    };
  }
  const { tool, why } = value;
  if (typeof tool !== 'string' || tool.trim() === '') {
    return {
      problem:
        '`tryInsteadTool.tool` must name the tool to try — its registered name, e.g. ' +
        "{ tool: 'cluster_inventory', why: 'it lists the collected names' }. The name is " +
        'recorded as declared and never looked up (a provider may serve it).',
    };
  }
  const name = tool.trim();
  if (notGiven(why)) return { value: { tool: name } };
  if (typeof why !== 'string' || why.trim() === '') {
    return {
      problem:
        `\`tryInsteadTool.why\` (for '${name}') must be a sentence — say why that tool, or ` +
        'omit the field.',
    };
  }
  return { value: { tool: name, why: why.trim() } };
}

/**
 * Say "I looked, and there is nothing" in a way a model cannot read as a
 * failure — and cannot productively retry.
 *
 * Returns the value a tool's `execute` should return. The framework
 * recognizes it at the dispatch boundary and gives it a delivered status of
 * `'absent'` (routable by `onToolStatus`), a `tools.absent` event, and an
 * evidence-corpus rule of its own.
 *
 * @example a port-lookup tool that found no matching FLOGI
 *   defineTool({
 *     name: 'flogi_for_port',
 *     description: 'FLOGI entries for one interface',
 *     inputSchema: { type: 'object', properties: { switch: { type: 'string' },
 *       port: { type: 'string' } }, required: ['switch', 'port'] },
 *     execute: ({ switch: sw, port }) => {
 *       const rows = fcns.flogi(sw, port);
 *       if (rows.length > 0) return rows;
 *       return absent({
 *         what: `FLOGI entries on ${port}`,
 *         checked: [
 *           `${sw}: the live fcns database`,
 *           { what: 'window: the last 24h', why: 'FLOGI history retention on this fabric' },
 *         ],
 *         notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
 *         cannotCover: [{ what: 'ports on the peer fabric',
 *           why: 'this collector is scoped to one fabric' }],
 *         tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
 *       });
 *     },
 *   });
 */
export function absent(decl: AbsenceDeclaration): ToolAbsence {
  const fn = 'absent';
  if (typeof decl !== 'object' || decl === null) {
    throw new Error(
      `${fn}: takes a declaration — { what, checked, notChecked?, cannotCover?, tryInstead?, ` +
        `tryInsteadTool? }.`,
    );
  }
  const what = typeof decl.what === 'string' ? decl.what.trim() : '';
  if (what === '') {
    throw new Error(
      `${fn}: \`what\` must say what was looked for (e.g. 'FLOGI entries on fc1/3'). An ` +
        `absence that cannot name what it did not find is indistinguishable from a tool that ` +
        `returned nothing by accident.`,
    );
  }
  const checked = normalizeCoverageList(fn, 'checked', decl.checked, false);
  if (checked.length === 0) {
    throw new Error(
      `${fn}: '${what}' — \`checked\` must name at least one source, window or population ` +
        `that WAS searched. An absence with no coverage is a null with extra steps: the reader ` +
        `still cannot tell "I looked and there is nothing" from "I could not look", which is ` +
        `the confusion this function exists to remove. If you genuinely could not look, that ` +
        `is an error — throw, or return a failure the model can retry.`,
    );
  }
  const notChecked = normalizeCoverageList(fn, 'notChecked', decl.notChecked, false);
  const cannotCover = normalizeCoverageList(fn, 'cannotCover', decl.cannotCover, true);
  const sentence = readSentence(decl.tryInstead);
  if (sentence.problem !== undefined) throw new Error(`${fn}: '${what}' — ${sentence.problem}`);
  const tool = readToolSuggestion(decl.tryInsteadTool);
  if (tool.problem !== undefined) throw new Error(`${fn}: '${what}' — ${tool.problem}`);
  const tryInstead = sentence.value;
  const tryInsteadTool = tool.value;
  // The name's charset is the tool registry's question: the owner warns in
  // dev mode and never throws — the verdict a `defineTool` of it would get.
  if (tryInsteadTool !== undefined) warnIfInvalidToolName(tryInsteadTool.tool);

  return {
    af_absent: true,
    outcome: 'nothing_found',
    looked_for: what,
    checked,
    ...(notChecked.length > 0 && { not_checked: notChecked }),
    ...(cannotCover.length > 0 && { cannot_cover: cannotCover }),
    retry_returns_the_same: true,
    ...(tryInstead !== undefined && { try_instead: tryInstead }),
    ...(tryInsteadTool !== undefined && { try_instead_tool: tryInsteadTool }),
    note: ABSENCE_NOTE,
  };
}

/**
 * Recognize (or decline to recognize) a value as an absence — STRICT, and the
 * strictness is the zero-cost guarantee. Only a plain object whose
 * `af_absent` is exactly `true` and whose `checked` is a non-empty array
 * qualifies; every other value any tool has ever returned takes the path it
 * always took, byte for byte.
 *
 * `undefined` means "not an absence", never "a malformed one" — this library
 * does not guess at a shape it did not mint.
 */
export function readAbsence(value: unknown): ToolAbsence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (rec[ABSENCE_MARKER] !== true) return undefined;
  if (!Array.isArray(rec.checked) || rec.checked.length === 0) return undefined;
  return value as ToolAbsence;
}

/** The absence's coverage, in the normalized three-list shape everything
 *  downstream (the event, the answer block) reads. */
export function coverageOfAbsence(absence: ToolAbsence): Coverage {
  return {
    checked: absence.checked ?? [],
    notChecked: absence.not_checked ?? [],
    cannotCover: absence.cannot_cover ?? [],
  };
}

/**
 * The absence's sentence, read by the rules `absent()` mints by. `undefined`
 * when it declared none, AND when it declared one those rules refuse: an
 * envelope minted elsewhere (a non-JS tool, a hand-built value) is read,
 * never repaired, and the absence itself is still an absence either way.
 */
export function tryInsteadOfAbsence(absence: ToolAbsence): string | undefined {
  return readSentence(absence.try_instead).value;
}

/**
 * The absence's typed tool, read by the same rules — a copy, never the
 * object the envelope holds. `undefined` when it declared none, or one those
 * rules refuse (see {@link tryInsteadOfAbsence}).
 */
export function tryInsteadToolOfAbsence(absence: ToolAbsence): TryInsteadTool | undefined {
  return readToolSuggestion(absence.try_instead_tool).value;
}
