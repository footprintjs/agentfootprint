import type { TraceToolpackArtifacts, ResolvedToolpackOptions } from '../types.js';
import type { ToolpackIndex } from './packIndex.js';
import type { ToolCallReader } from './toolCallJournal.js';
import type { Tool } from '../../tools/tools.js';
import type { FiledFinding } from './findingEvidence.js';
import {
  CONTEXT_ERROR_EVENT,
  isAdvisory,
  subjectsOf,
  stateJoinFor,
  witnessStepsOf,
  dispositionLine,
  UNFILABLE_CONTEXT_ERROR_KINDS,
  CONTEXT_ERROR_KINDS,
  unanswerableKind,
  DISPOSITION_EVENT,
  INTEGRITY_BOUND,
} from './findingEvidence.js';
import type { ContextError } from '../../integrity/finding/types.js';
import { truncateText } from './valueLines.js';
import { displayText, normalizeKey, clampParam } from '../bounded.js';
import {
  FINDING_MESSAGE_CHARS,
  FINDING_SUBJECT_CAP,
  FINDING_WITNESS_CAP,
  DISPOSITION_ROW_CAP,
  FINDINGS_DEFAULT,
  SILENT_CHECK_NAME_CAP,
} from './structuralLimits.js';
import type { CheckReport } from '../../integrity/disposition/types.js';
import { defineTool } from '../../tools/tools.js';
import { TOOLPACK_HARD_CAPS } from '../types.js';

/**
 * The Context Integrity findings of this run — what it contradicted itself
 * about, and the join from there to the state behind it.
 *
 * This tool READS. Every finding was already detected, judged and
 * deduplicated at filing time (`contextErrorIdentity`), so nothing here
 * re-runs a check or re-decides one: it enumerates what was filed and adds
 * the one thing a findings stream cannot carry — the POINTERS. Each finding
 * names the step it was filed at, the steps its witnesses came from, and
 * (when a subject is a tracked state key) the writer behind it, in the exact
 * shapes `trace_node` / `trace_slice` / `who_wrote` / `backtrack` /
 * `find_in_trace` accept. The model's next call is never an id it had to
 * assemble by hand.
 *
 * HONEST ABSENCE is the reason the tool exists in this family at all, and
 * its sentences must never collapse into one:
 *
 *   - a kind no check can file  → UNANSWERABLE, said before any evidence is
 *                                 read: which classes are filable is a fact
 *                                 about the build, not about the run.
 *   - no event tail at all      → NO EVIDENCE. Findings ride the event
 *                                 stream; without it this run cannot be
 *                                 reported on either way.
 *   - a tail with no integrity  → no checker was registered, or the tail
 *     events                      was capped before they landed.
 *   - rows, but zero `checked`  → NOTHING WAS CHECKED. Every encounter was
 *     encounters                  unreachable, out of scope, or never met —
 *                                 silence, and never a clean bill.
 *   - rows with real `checked`  → the checkers RAN and found nothing —
 *     encounters, no findings     health, stated with the encounter count
 *                                 that earned it and the rows that prove it,
 *                                 and with the standing bound that a seam
 *                                 nobody checks files nothing.
 *
 * The green sentence is the one that must be EARNED: it is chosen by summing
 * the rows' `checked` counts, never by the mere absence of a finding.
 */
function buildFindContextErrors(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  reader: ToolCallReader,
  opts: ResolvedToolpackOptions,
): Tool {
  const isKnownStep = (id: string | undefined): id is string =>
    id !== undefined && (index.firstIdxOf.has(id) || index.nodes.has(id));

  const readFindings = (): FiledFinding[] =>
    reader.eventsOf(CONTEXT_ERROR_EVENT).map((event) => {
      const error = event.payload as Partial<ContextError> & { readonly iteration?: number };
      const filedAt = event.meta.runtimeStageId;
      const iteration =
        typeof error.iteration === 'number'
          ? error.iteration
          : typeof event.meta.iterIndex === 'number'
          ? event.meta.iterIndex
          : undefined;
      return {
        error,
        ...(typeof filedAt === 'string' && filedAt !== '' && { filedAt }),
        ...(iteration !== undefined && { iteration }),
      };
    });

  const renderFinding = (filed: FiledFinding, position: number): string[] => {
    const { error } = filed;
    const kind = typeof error.kind === 'string' ? error.kind : '⚠ (kind not recorded)';
    const seam = typeof error.seam === 'string' ? `@${error.seam}` : '@⚠ (seam not recorded)';
    const stamps = [
      typeof error.epoch === 'number' ? `epoch ${error.epoch}` : '',
      filed.iteration !== undefined ? `iteration ${filed.iteration}` : '',
      error.synthetic === true ? 'SYNTHETIC canary — not a real defect' : '',
      isAdvisory(filed) ? 'ADVISORY — counted apart from real defects' : '',
    ].filter(Boolean);
    const message =
      typeof error.message === 'string' && error.message !== ''
        ? truncateText(displayText(error.message), FINDING_MESSAGE_CHARS)
        : '⚠ no message recorded on this finding';
    const lines = [
      `[${position}] ${kind} ${seam}${
        stamps.length > 0 ? ` · ${stamps.join(' · ')}` : ''
      } — ${message}`,
    ];

    // WHO it is about — plus the free-text bridge into ids for the first one.
    const subjects = subjectsOf(error.subjects);
    if (subjects.length === 0) {
      lines.push('    about: ⚠ no subjects recorded — the finding names no stamped identity.');
    } else {
      const shown = subjects.slice(0, FINDING_SUBJECT_CAP).map((s) => `${s.kind}:${s.id}`);
      lines.push(
        `    about: ${shown.join(', ')}${
          subjects.length > FINDING_SUBJECT_CAP
            ? `, … +${subjects.length - FINDING_SUBJECT_CAP} more`
            : ''
        } → find_in_trace('${subjects[0].id}')`,
      );
      // THE STATE JOIN: when a subject names a key the commit log really
      // wrote, answer the "and what was it?" question here rather than
      // making the model guess which key to ask about.
      for (const subject of subjects.slice(0, FINDING_SUBJECT_CAP)) {
        const path = normalizeKey(subject.id, index.knownPaths);
        if (!index.knownPaths.has(path)) continue;
        const join = stateJoinFor(index, path, opts.previewChars);
        if (join !== undefined) {
          lines.push(`    state: ${join}`);
          break;
        }
      }
    }

    // WHERE it was filed — the step, when it is a step this run really ran.
    if (filed.filedAt === undefined) {
      lines.push(
        '    filed at: ⚠ no step stamped on the event — it cannot be located in the trace.',
      );
    } else if (isKnownStep(filed.filedAt)) {
      lines.push(
        `    filed at ${filed.filedAt} → trace_node('${filed.filedAt}') · ` +
          `trace_slice({ runtimeStageId: '${filed.filedAt}' })`,
      );
    } else {
      lines.push(
        `    filed at ${filed.filedAt} ⚠ — not a step in this run's execution tree (a run-boundary ` +
          `marker, or evidence from another run), so the step drills cannot open it.`,
      );
    }

    // THE TWO FACTS THAT DISAGREED — as ids, when the assertions were stamped.
    const witnesses = witnessStepsOf(error.witnesses);
    if (witnesses.total === 0) {
      lines.push('    witnesses: ⚠ none recorded — the proof did not travel with the finding.');
    } else {
      const known = witnesses.ids.filter(isKnownStep);
      const shown = known.slice(0, FINDING_WITNESS_CAP);
      lines.push(
        `    witnesses (${witnesses.total}): ` +
          (shown.length > 0
            ? `${shown.join(', ')} → trace_node(<id>)`
            : '⚠ none carries a step id in this run') +
          (witnesses.unstamped > 0
            ? ` · ⚠ ${witnesses.unstamped} assertion(s) carry no step stamp`
            : ''),
      );
    }
    return lines;
  };

  const renderCheckers = (rows: readonly CheckReport[] | undefined, header: string): string[] => {
    if (rows === undefined) {
      return [
        `CHECKERS: ⚠ no disposition accounting in this run's event tail — nothing records WHICH ` +
          `checks ran, so the absence of a finding at any other seam says nothing at all.`,
      ];
    }
    if (rows.length === 0) {
      return [
        `CHECKERS: ⚠ none registered — this agent's configuration made no Context Integrity check ` +
          `applicable (a check registers only where its preconditions exist), so nothing was ` +
          `checked and nothing could be found. That is honest absence, not health.`,
      ];
    }
    const lines = [header, ...rows.slice(0, DISPOSITION_ROW_CAP).map(dispositionLine)];
    if (rows.length > DISPOSITION_ROW_CAP) {
      lines.push(`…and ${rows.length - DISPOSITION_ROW_CAP} more check row(s) (output capped)`);
    }
    return lines;
  };

  return defineTool<{ kind?: string; limit?: number }, string>({
    name: 'find_context_errors',
    description:
      'What did this run CONTRADICT ITSELF about? Lists the Context Integrity findings the ' +
      'library already caught — an invariant violated, an offered action whose inputs left ' +
      'scope, an argument nothing served, a claim the record does not support, a lookup for a ' +
      'value this run produced that came back empty — each with the ' +
      'step it was filed at and the ' +
      'exact drill that opens the state behind it. Call it EARLY when an answer looks wrong: a ' +
      'contradiction the library already caught beats re-deriving one. Reads only; nothing is ' +
      're-checked or re-judged. When no finding evidence was captured it says so plainly rather ' +
      `than reporting a clean run. The finding type also names ${UNFILABLE_CONTEXT_ERROR_KINDS.map(
        (kind) => `'${kind}'`,
      ).join(' and ')}, and no check in this build files ${
        UNFILABLE_CONTEXT_ERROR_KINDS.length === 1 ? 'it' : 'them'
      } — this tool cannot report on ` +
      `that class${UNFILABLE_CONTEXT_ERROR_KINDS.length === 1 ? '' : 'es'} at all, so its ` +
      'silence about it is not evidence. ' +
      `Bounded by limit (default ${FINDINGS_DEFAULT}, hard cap ${TOOLPACK_HARD_CAPS.contextErrorsMax}).`,
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: CONTEXT_ERROR_KINDS,
          description:
            'Optional: only findings of this defect class. Omit to see every finding. Only ' +
            'classes a check in this build can file are listed here.',
        },
        limit: {
          type: 'integer',
          description: `Findings to list (default ${FINDINGS_DEFAULT}, hard cap ${TOOLPACK_HARD_CAPS.contextErrorsMax}).`,
        },
      },
      additionalProperties: false,
    },
    execute: ({ kind, limit }) => {
      // ── a question no build of this library can answer ──────────────────
      // Ahead of every evidence check, because which classes are FILABLE is a
      // property of the build, not of the run. The one exception is evidence
      // itself: if the tail really does carry findings under that kind (a
      // foreign filer, or a recording made by a build that shipped the
      // check), listing them beats refusing them — the refusal claims nothing
      // ever looked, and here something did.
      if (kind !== undefined) {
        const refusal = unanswerableKind(kind);
        const carried =
          artifacts.events !== undefined && readFindings().some((f) => f.error.kind === kind);
        if (refusal !== undefined && !carried) return refusal;
      }

      // ── absence, stated in the sentence the situation deserves ──────────
      if (artifacts.events === undefined) {
        return (
          `find_context_errors: ⚠ NO FINDING EVIDENCE — these artifacts carry no event tail at ` +
          `all. Context Integrity findings ride the event stream (${CONTEXT_ERROR_EVENT}), and ` +
          `the per-run accounting of which checks ran rides ${DISPOSITION_EVENT}; with neither ` +
          `retained, this run cannot be reported on either way. That is "no evidence", NOT "no ` +
          `context errors". Capture the tail with recordRun(agent), or leave it on for a ` +
          `self-explaining agent (selfExplain({ include: { events: true } }) — the default).`
        );
      }

      const filed = readFindings();
      const dispositionEvent = reader.eventsOf(DISPOSITION_EVENT).at(-1);
      const rows =
        dispositionEvent !== undefined && Array.isArray(dispositionEvent.payload.rows)
          ? (dispositionEvent.payload.rows as readonly CheckReport[])
          : dispositionEvent !== undefined
          ? []
          : undefined;

      if (filed.length === 0 && dispositionEvent === undefined) {
        return (
          `find_context_errors: ⚠ this run's event tail carries no Context Integrity events — ` +
          `neither findings (${CONTEXT_ERROR_EVENT}) nor the per-run disposition accounting ` +
          `(${DISPOSITION_EVENT}). Either no checker was registered for this agent's ` +
          `configuration, or the tail was capped or filtered before they were captured ` +
          `(${artifacts.events.length} event(s) retained). Read it as "no evidence", never as a ` +
          `clean bill of health.`
        );
      }

      // Canary material is quarantined from the real counts, everywhere the
      // family reports — a synthetic finding is proof a check is ALIVE, not
      // proof the run went wrong. Advisories are shown but counted apart for
      // the same reason: a seam that filed one said it is not a defect.
      const nonSynthetic = filed.filter((f) => f.error.synthetic !== true);
      const synthetic = filed.length - nonSynthetic.length;
      const real = nonSynthetic.filter((f) => !isAdvisory(f));
      const matching =
        kind === undefined ? nonSynthetic : nonSynthetic.filter((f) => f.error.kind === kind);

      const posture =
        dispositionEvent !== undefined && typeof dispositionEvent.payload.posture === 'string'
          ? dispositionEvent.payload.posture
          : 'unknown';
      const workExisted = dispositionEvent?.payload.workExisted === true;
      const header = `CHECKERS (posture: ${posture} · ${
        workExisted ? 'the run did work a checker could see' : '⚠ the run did no checkable work'
      }):`;

      // The rows count ENCOUNTERS that filed; the event stream is
      // deduplicated by identity. When the two disagree, say which is which —
      // a reader who sees "6" in a row and one finding in the list would
      // otherwise conclude the list dropped five.
      const rowFindings = (rows ?? []).reduce(
        (sum, report) => sum + (typeof report.findings === 'number' ? report.findings : 0),
        0,
      );

      const matchingAdvisories = matching.filter(isAdvisory).length;
      const matchingDefects = matching.length - matchingAdvisories;

      // ── what the rows actually say a check DID ──────────────────────────
      // The disposition rows are the only witness that a check ever looked,
      // and a green headline is earned by `checked` encounters alone: an
      // `unreachable` encounter is one the check could not see the evidence
      // for, a `not-applicable` one is out of its scope by rule, and a
      // registered check with zero encounters never met a subject. Summing
      // them defensively — a tail parsed back from JSON can carry anything.
      const sumRows = (pick: (report: CheckReport) => unknown): number =>
        (rows ?? []).reduce((sum, report) => {
          const value = pick(report);
          return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        }, 0);
      const num = (value: unknown): number =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0;
      const totalChecked = sumRows((report) => report.checked);
      const totalUnreachable = sumRows((report) => report.unreachable);
      const totalNotApplicable = sumRows((report) => report.notApplicable);
      const neverRanRows = (rows ?? []).filter(
        (report) => num(report.checked) + num(report.notApplicable) + num(report.unreachable) === 0,
      ).length;
      // Checks that CHECKED nothing — a superset of `neverRanRows`: a check
      // whose every encounter was out of scope or unreachable also passed
      // nothing. Named, because the headline must not average them away.
      const silentChecks = (rows ?? [])
        .filter((report) => num(report.checked) === 0)
        .map(
          (report) =>
            `${typeof report.check === 'string' ? report.check : '?'} @${report.seam ?? '?'}`,
        );

      /** Nothing matched: WHICH absence is this? The rows decide, not the silence. */
      const absenceHeadline = (): string => {
        if (rows === undefined) {
          return (
            `CONTEXT ERRORS — ⚠ NONE FILED, AND NOTHING RECORDS WHICH CHECKS RAN. This tail ` +
            `carries no disposition accounting (${DISPOSITION_EVENT}), so no check is known to ` +
            `have run and none is known to have passed. Read it as unmeasured, not as clean.`
          );
        }
        if (rows.length === 0) {
          return (
            `CONTEXT ERRORS — ⚠ NONE FILED, AND NO CHECK WAS REGISTERED. This agent's ` +
            `configuration made no Context Integrity check applicable, so nothing was checked ` +
            `and nothing could be found. That is honest absence, not health.`
          );
        }
        if (totalChecked === 0) {
          const why = [
            totalUnreachable > 0
              ? `${totalUnreachable} unreachable (no stamped identity edge, so the check could ` +
                `not see the evidence)`
              : '',
            totalNotApplicable > 0 ? `${totalNotApplicable} out of scope by rule` : '',
            neverRanRows > 0 ? `${neverRanRows} check(s) never met a subject at all` : '',
          ].filter(Boolean);
          return (
            `CONTEXT ERRORS — ⚠ NOTHING WAS CHECKED. The ${rows.length} registered check(s) ` +
            `below reached zero checked encounter(s)${
              why.length > 0 ? `: ${why.join(' · ')}` : ''
            }` +
            `. A check that never saw a subject cannot have passed one, so this is silence about ` +
            `every seam, not a clean run.`
          );
        }
        // Green, but not evenly. A headline that sums `checked` across every
        // row reads as coverage the rows do not support: one busy check can
        // carry a total while another registered check looked at NOTHING.
        // The per-check rows already say so; a reader who stops at the
        // headline must not get the rosier story. Same law as the rows —
        // "ran 0×" is silence about that seam, never a pass.
        if (silentChecks.length > 0) {
          const named = silentChecks.slice(0, SILENT_CHECK_NAME_CAP).join(', ');
          const more =
            silentChecks.length > SILENT_CHECK_NAME_CAP
              ? `, and ${silentChecks.length - SILENT_CHECK_NAME_CAP} more`
              : '';
          return (
            `CONTEXT ERRORS — none filed, ⚠ AND COVERAGE IS PARTIAL. ` +
            `${rows.length - silentChecks.length} of ${rows.length} registered check(s) ` +
            `actually checked something (${totalChecked} checked encounter(s)) and found ` +
            `nothing; ${silentChecks.length} checked NOTHING at all — silent about its seam, ` +
            `not clean: ${named}${more}. This green covers only the checks that ran.`
          );
        }
        return (
          `CONTEXT ERRORS — none filed. All ${rows.length} registered check(s) below RAN ` +
          `(${totalChecked} checked encounter(s)); nothing they cover was violated.`
        );
      };

      const lines: string[] = [];
      if (matching.length === 0 && nonSynthetic.length === 0 && rowFindings > 0) {
        lines.push(
          `CONTEXT ERRORS — ⚠ EVIDENCE MISSING. The checker rows below report ${rowFindings} ` +
            `finding(s) filed by this run, and this event tail carries NONE of them — the tail ` +
            `was capped or filtered. The contradictions happened; their detail did not survive. ` +
            `This is the opposite of a clean run.`,
        );
      } else if (matching.length === 0 && nonSynthetic.length > 0) {
        const kinds = [...new Set(nonSynthetic.map((f) => String(f.error.kind ?? '?')))].join(', ');
        lines.push(
          `CONTEXT ERRORS — no '${kind}' findings in this run. It filed ${nonSynthetic.length} ` +
            `finding(s) of other kinds: ${kinds}. Call again without 'kind' to see them.`,
        );
      } else if (matching.length === 0) {
        lines.push(absenceHeadline());
      } else {
        const cap = clampParam(limit, FINDINGS_DEFAULT, 1, TOOLPACK_HARD_CAPS.contextErrorsMax);
        const shown = matching.slice(0, cap);
        lines.push(
          `CONTEXT ERRORS — ${matchingDefects} finding(s) filed by this run's integrity checks` +
            (matchingAdvisories > 0
              ? `, plus ${matchingAdvisories} advisory (counted apart — a seam filed them as not ` +
                `a defect)`
              : '') +
            ` (showing ${shown.length} of ${matching.length}). Each was detected and deduplicated ` +
            `when it happened; nothing is re-judged here.`,
          '',
        );
        shown.forEach((entry, i) => lines.push(...renderFinding(entry, i + 1)));
        if (shown.length < matching.length) {
          lines.push(
            `…${matching.length - shown.length} more finding(s) — raise limit (hard cap ` +
              `${TOOLPACK_HARD_CAPS.contextErrorsMax}) or filter with 'kind'.`,
          );
        }
      }
      if (synthetic > 0) {
        lines.push(
          `(${synthetic} synthetic canary finding(s) filed in dev posture are quarantined from ` +
            `the count above — they prove a check can still catch its own defect.)`,
        );
      }
      if (real.length > 0 && rowFindings > real.length) {
        lines.push(
          `note: the rows below count every ENCOUNTER that filed (${rowFindings}); the list above ` +
            `is deduplicated by identity (${real.length} distinct defect(s)) — one defect ` +
            `re-detected on a later iteration stays ONE finding.`,
        );
      }

      lines.push('', ...renderCheckers(rows, header), '', INTEGRITY_BOUND);
      lines.push(
        `Next: trace_node / trace_slice open the step a finding was filed at · who_wrote and ` +
          `backtrack explain a state key · find_in_trace turns a subject's name into ids.`,
      );
      return lines.join('\n');
    },
  });
}

export { buildFindContextErrors };
