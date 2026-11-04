import type { ContextErrorKind, ContextError } from '../../integrity/finding/types.js';
import {
  safeStringify,
  boundedPreview,
  displayKey,
  displayText,
  renderPreview,
} from '../bounded.js';
import type { ToolpackIndex } from './packIndex.js';
import { findLastWriter, commitValueAt } from 'foottrace';
import { redactionNote } from './valueLines.js';
import type { CheckReport } from '../../integrity/disposition/types.js';

// ── find_context_errors ────────────────────────────────────────────────────

/**
 * The six ContextErrorKinds — each mapped to the check that can FILE it in
 * this build, or `false` when no check ships for that class.
 *
 * Two jobs in one table:
 *
 *   - the compile-time pin. The record's KEY type is `ContextErrorKind`, so
 *     a kind added to the finding type without joining this list fails to
 *     compile HERE, rather than becoming a value the tool's enum silently
 *     rejects at run time.
 *   - the honesty gate. `ContextErrorKind` names nine defect classes;
 *     `src/integrity/` ships eight checks. Offering the sixth in the
 *     schema enum invites a query whose only possible answer is a negative
 *     verdict about a class nothing in the library could have filed — the
 *     tool telling a model "no duplicate-execution errors" when nothing on
 *     earth was looking for one. Only filable kinds reach the enum; the
 *     description and the refusal are generated from this same table, so a
 *     check that lands is advertised everywhere by flipping one entry.
 */
const CONTEXT_ERROR_KIND_CHECKS: Record<ContextErrorKind, string | false> = {
  'invariant-violation': 'src/integrity/invariant-violation (write + wire)',
  'unsupported-argument': 'src/integrity/unsupported-argument (choice)',
  'dangling-reference': 'src/integrity/dangling-reference (compose)',
  'duplicate-execution': false,
  'unsupported-claim': 'src/integrity/unsupported-claim (claim)',
  'empty-lookup': 'src/integrity/empty-lookup (write)',
  'column-type-mismatch': 'src/integrity/column-types (write)',
  'missing-column': 'src/integrity/column-types (write)',
  'prior-turn-evidence': 'src/integrity/prior-turn-evidence (claim)',
};

const ALL_CONTEXT_ERROR_KINDS = Object.keys(CONTEXT_ERROR_KIND_CHECKS) as ContextErrorKind[];

/** The kinds the tool OFFERS — the ones a shipped check can actually file. */
const CONTEXT_ERROR_KINDS = ALL_CONTEXT_ERROR_KINDS.filter(
  (kind) => CONTEXT_ERROR_KIND_CHECKS[kind] !== false,
);

/** Named in the finding type, filable by nothing here. Said out loud, never offered. */
const UNFILABLE_CONTEXT_ERROR_KINDS = ALL_CONTEXT_ERROR_KINDS.filter(
  (kind) => CONTEXT_ERROR_KIND_CHECKS[kind] === false,
);

/**
 * The answer for a `kind` this build cannot report on.
 *
 * It runs BEFORE the evidence checks on purpose: whether a class is filable
 * is a fact about the BUILD, not about the run, and it stays true however
 * much evidence the tail carries. Args validation is a dial
 * (`toolArgValidation: 'off' | 'warn'`), so the enum is a menu rather than a
 * wall — `execute` really is reachable with a kind it never offered, and the
 * one answer it must never give there is a negative verdict.
 */
function unanswerableKind(kind: string): string | undefined {
  const offered = CONTEXT_ERROR_KINDS.join(', ');
  if (!Object.prototype.hasOwnProperty.call(CONTEXT_ERROR_KIND_CHECKS, kind)) {
    return (
      `find_context_errors: ⚠ '${kind}' is not a defect class this library knows — it is not a ` +
      `Context Integrity kind at all, so nothing was ever filed under that word and this answer ` +
      `says nothing about the run. Classes this build can file: ${offered}.`
    );
  }
  if (CONTEXT_ERROR_KIND_CHECKS[kind as ContextErrorKind] !== false) return undefined;
  return (
    `find_context_errors: ⚠ UNANSWERABLE — '${kind}' is a defect class the finding type names, ` +
    `and no check in this build can file it. Nothing ever looked for one, so silence about it is ` +
    `not evidence of its absence. Classes this build can file: ${offered} — call again with one ` +
    `of those, or with no 'kind' at all.`
  );
}

const CONTEXT_ERROR_EVENT = 'agentfootprint.integrity.context_error';

const DISPOSITION_EVENT = 'agentfootprint.integrity.disposition';

/**
 * An advisory is a filed finding the seam marked as NOT a defect (9.61.0 —
 * today, an answer that DECLINES to claim a fact the run verified). Same
 * quarantine rule as the dev canary: it is shown, and it is never counted
 * as a context error. A reader that did not know the field would report
 * doubt as a contradiction.
 */
function isAdvisory(filed: FiledFinding): boolean {
  return filed.error.advisory === true;
}

/**
 * The standing bound of the whole Context Integrity family, repeated
 * wherever this tool reports — because the sentence it prevents ("nothing
 * was found, so the run is fine") is the exact misreading that let two
 * shipped checks in this codebase decay into decoration.
 */
const INTEGRITY_BOUND =
  '⚠ Green means no REGISTERED check was violated — it does not mean no context error exists. ' +
  'A seam with no checker files nothing, and an encounter with no stamped identity is silent.';

/**
 * One filed finding, joined to the step the event was stamped with.
 *
 * The payload is read as PARTIAL on purpose: an event tail may have been
 * parsed back from JSON, or written by an older version of the library that
 * did not file every field this one knows about.
 */
interface FiledFinding {
  readonly error: Partial<ContextError> & { readonly iteration?: number };
  readonly filedAt?: string;
  readonly iteration?: number;
}

/** Subjects, read defensively: an event tail may have been parsed from JSON. */
function subjectsOf(raw: unknown): { kind: string; id: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { kind: string; id: string }[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const subject = item as { kind?: unknown; id?: unknown };
    out.push({
      kind: typeof subject.kind === 'string' ? subject.kind : '?',
      id: typeof subject.id === 'string' ? subject.id : safeStringify(subject.id),
    });
  }
  return out;
}

/** The witness assertions' step ids — the two-or-more facts that disagreed. */
function witnessStepsOf(raw: unknown): { ids: string[]; total: number; unstamped: number } {
  if (!Array.isArray(raw)) return { ids: [], total: 0, unstamped: 0 };
  const ids: string[] = [];
  let unstamped = 0;
  for (const item of raw) {
    const stamp =
      item !== null && typeof item === 'object'
        ? (item as { runtimeStageId?: unknown }).runtimeStageId
        : undefined;
    if (typeof stamp === 'string' && stamp !== '') {
      if (!ids.includes(stamp)) ids.push(stamp);
    } else unstamped++;
  }
  return { ids, total: raw.length, unstamped };
}

/**
 * The commit-log answer for ONE state key, in a sentence.
 *
 * It walks nothing new: `findLastWriter` + `commitValueAt` are the same
 * pair `who_wrote` and `get_value` use, so there is no second reader of the
 * commit log to drift — only a shorter sentence, and the exact follow-up
 * calls that open the long one.
 */
function stateJoinFor(
  index: ToolpackIndex,
  path: string,
  previewChars: number,
): string | undefined {
  const writer = findLastWriter(index.commitLog, path);
  if (!writer) return undefined;
  const preview = boundedPreview(
    commitValueAt(index.commitLog, index.commitLog.indexOf(writer), path),
    previewChars,
  );
  const dotted = displayKey(path);
  return (
    `'${dotted}' = ${displayText(renderPreview(preview))}${redactionNote([writer], path)} — last ` +
    `written by ${writer.runtimeStageId} ("${writer.stage}") → who_wrote('${dotted}') · ` +
    `backtrack({ variable: '${dotted}' })`
  );
}

/** Render ONE disposition row: did this check run, and what did it see? */
function dispositionLine(report: CheckReport): string {
  const check = typeof report.check === 'string' ? report.check : '?';
  const head = `- ${check} @${report.seam ?? '?'}`;
  const checked = typeof report.checked === 'number' ? report.checked : 0;
  const notApplicable = typeof report.notApplicable === 'number' ? report.notApplicable : 0;
  const unreachable = typeof report.unreachable === 'number' ? report.unreachable : 0;
  const findings = typeof report.findings === 'number' ? report.findings : 0;
  const synthetic = typeof report.synthetic === 'number' ? report.synthetic : 0;

  if (checked + notApplicable + unreachable === 0) {
    return (
      `${head}: ⚠ REGISTERED BUT NEVER RAN — zero encounters while this run did work. The check ` +
      `is wired and nothing fed it (wiring rot); its silence is not health.`
    );
  }
  // `ran 0×` with encounters on the other counters is NOT "found nothing":
  // every encounter was out of scope or unreachable, so this seam went
  // unchecked. Saying it found nothing would read the count backwards.
  const parts = [
    checked > 0 ? `ran ${checked}×` : `⚠ ran 0× — nothing at this seam was actually checked`,
    ...(findings > 0
      ? [`${findings} finding(s)`]
      : checked > 0
      ? ['0 findings — the checker ran and found nothing at this seam']
      : []),
  ];
  if (notApplicable > 0) {
    parts.push(`not-applicable ${notApplicable} (out of scope by rule)`);
  }
  if (unreachable > 0) {
    parts.push(
      `unreachable ${unreachable} ⚠ — no stamped identity edge, so those encounters were SILENT, ` +
        `not clean`,
    );
  }
  if (synthetic > 0) parts.push(`synthetic canary ${synthetic} (quarantined from the real counts)`);
  if (typeof report.lastFiredAt === 'number') {
    parts.push(`last fired ${new Date(report.lastFiredAt).toISOString()}`);
  }
  return `${head}: ${parts.join(' · ')}`;
}

export {
  CONTEXT_ERROR_KINDS,
  UNFILABLE_CONTEXT_ERROR_KINDS,
  unanswerableKind,
  CONTEXT_ERROR_EVENT,
  DISPOSITION_EVENT,
  isAdvisory,
  INTEGRITY_BOUND,
  subjectsOf,
  witnessStepsOf,
  stateJoinFor,
  dispositionLine,
};
export type { FiledFinding };
