/**
 * findings/contingent — no towers on unverified lemmas.
 *
 * Pattern: one pure rule over (the values a moment used, the corpus's
 *          carriers, the ledger's fold); the sibling of
 *          `integrity/unsupported-claim` (a value against the settled facts,
 *          at the answer) and `integrity/unsupported-argument` (a value
 *          against what was served, at dispatch). Those two ask "did this
 *          value come from a result at all?"; this asks "did it come ONLY
 *          from results the model itself set aside?".
 * Role:    core/ layer leaf. Two moments call it: `stages/route.ts ·
 *          judgeEvidence` over the values the extractor found in the answer
 *          (the gate's `EvidenceVerdict.grounded`), and `stages/toolCalls.ts`
 *          over the DATA values of a call's arguments (`groundedArgumentValues`
 *          below). Both hand the rows to `ledger.ts · recordFindings`, the one
 *          writer.
 * Emits:   N/A — the writer emits `agentfootprint.findings.contingent`.
 *
 * ## The owner's ask, and the rule that answers it
 *
 * Agents build theorem towers on unverified lemmas — a value read in step
 * two, judged noise in step three, and used in the answer anyway, where it
 * reads exactly like a fact — and the staircase comes down as circular. The
 * ledger already has the standings the model DECLARED (`fact` / `open` /
 * `noise` / `ruled-out`); the evidence module already knows which result
 * carried which value. The rule joins the two and infers nothing:
 *
 *   a value the model USES — in its final answer, or as an argument of a
 *   later call — that came from a result the model itself declared `open`,
 *   `noise` or `ruled-out` is recorded as CONTINGENT.
 *
 * The fences, because they are the rule's honesty:
 * - DECLARED STANDINGS ONLY. A carrier with no standing row is undeclared —
 *   not "unverified" — and the rule says nothing about it: an undeclared
 *   carrier means the value stands.
 * - THE LAST STANDING PER RESULT IS CURRENT. Read off `foldLedger(...)
 *   .standingOf`, the ledger's own fold — never a second fold here.
 * - EVERY CARRIER NON-FACT. A value several results carried is contingent
 *   only when every one of them holds `open`, `noise` or `ruled-out`; one
 *   `fact` carrier and the value stands. A value the corpus lists more
 *   carriers for than it keeps (`ValueCarriers.truncated`) is NOT judged —
 *   "every carrier" cannot be read off a prefix — and NOTHING is judged from
 *   a corpus whose token ceiling was hit (`EvidenceCorpus.truncated`): the
 *   results after the cut carried nothing into the index, so a `fact`
 *   carrier past it is invisible and a row read off the prefix would be
 *   false. The gate downgrades itself to record-only under the same flag;
 *   this check files nothing.
 * - THE SAME QUESTION THE GATE ASKED. A grounded value carries the exact
 *   spellings the gate looked it up under (`EvidenceVerdict.grounded[].forms`,
 *   `extract.ts · candidateForms`); the carriers are read under those and
 *   no wider set. One row per VALUE: two spellings of one value in one
 *   answer (`0xef0101`, `ef0101`) share a canonical form
 *   (`normalize.ts · canonicalForm`) and file once.
 * - THE EXTRACTOR DECIDES WHAT IS A VALUE. Both moments read
 *   `evidence/extract.ts`'s DATA rule (a digit and a distinctive shape, or a
 *   declared shape), so a word is never a tower and an all-letters name
 *   needs the shape the gate would need. Exempt values — the person's
 *   message, the app's prompt — are never contingent: the model had them
 *   from a source it never judged.
 * - ONE ROW PER VALUE PER MOMENT, never per carrier; the carriers ride the
 *   row, in wire order, each with the standing that made it one. At
 *   dispatch, every standing in the batch's `_findings.previous` is filed
 *   BEFORE the check, so a standing declared on a sibling call of the same
 *   batch governs this call's arguments too.
 * - THIS TURN ONLY. The carriers are the current turn's results
 *   (`EvidenceCorpus.carriers`); a result of an earlier turn of a continued
 *   conversation, whatever its standing, carries nothing here — a value
 *   taken from it is not judged and gets no mark.
 *
 * Both doors must be armed for any of this to run — `.findings()` (the
 * standings) and `.namesAndNumbersFromEvidence()` (the corpus) — and an
 * agent with one or neither records the bytes it always did.
 */

import { stringLeaves } from '../../../integrity/argumentLeaves.js';
import type { EvidenceCorpus } from '../evidence/evidenceIndex.js';
import { candidateForms, extractCandidates } from '../evidence/extract.js';
import { canonicalForm } from '../evidence/normalize.js';
import type { GroundedValue, ResolvedEvidenceGate } from '../evidence/types.js';
import {
  CONTINGENT_VALUE_CHARS,
  type ContingentCarrier,
  type ContingentRow,
  type DeclaredOn,
  type Standing,
  type StandingRow,
} from './types.js';

/** The standings the rule reads: everything a model can declare short of standing on a result. */
const SET_ASIDE: readonly Standing[] = ['open', 'noise', 'ruled-out'];

/**
 * Whether any result's CURRENT standing is one the rule reads. The cheap
 * question both moments ask first: a ledger of facts alone — or of bases
 * alone — can produce no contingent row, so no corpus need be walked.
 */
export function hasSetAsideStanding(standingOf: ReadonlyMap<string, StandingRow>): boolean {
  for (const row of standingOf.values()) if (SET_ASIDE.includes(row.standing)) return true;
  return false;
}

/**
 * The DATA values of a call's arguments that the corpus holds, each with
 * the spellings it was looked up under, distinct by value, in argument
 * order, exempt values left out — the dispatch moment's twin of
 * `EvidenceVerdict.grounded`, asked with the gate's own `candidateForms`.
 * Every string leaf (`integrity/argumentLeaves.ts · stringLeaves`, the one
 * walk both argument checks share) is read by the extractor's rule, so a
 * number typed as a number, a word, and a short identifier are not
 * candidates here any more than they are in an answer.
 */
export function groundedArgumentValues(
  args: Readonly<Record<string, unknown>>,
  gate: ResolvedEvidenceGate,
  corpus: Pick<EvidenceCorpus, 'values'>,
  exempt: ReadonlySet<string>,
): GroundedValue[] {
  const out: GroundedValue[] = [];
  const seen = new Set<string>();
  for (const leaf of stringLeaves(args, '')) {
    for (const candidate of extractCandidates(leaf.value, gate)) {
      if (seen.has(candidate.value)) continue;
      seen.add(candidate.value);
      const forms = candidateForms(candidate);
      if (forms.some((f) => exempt.has(f))) continue;
      if (forms.some((f) => corpus.values.has(f))) out.push({ value: candidate.value, forms });
    }
  }
  return out;
}

/**
 * The rule: one row per value of `values` whose every carrier holds a
 * set-aside standing. `values` are the grounded values with the spellings
 * they were looked up under (`EvidenceVerdict.grounded`, or
 * `groundedArgumentValues`); the carriers are read under exactly those
 * spellings, each result once, in wire order. Two spellings of one value
 * share a canonical form and file one row. A corpus whose token ceiling was
 * hit (`truncated`) files nothing — see the header.
 */
export function contingentRowsOf(
  values: readonly GroundedValue[],
  corpus: Pick<EvidenceCorpus, 'carriers' | 'truncated'>,
  standingOf: ReadonlyMap<string, StandingRow>,
  declaredOn: DeclaredOn,
  iteration: number,
): ContingentRow[] {
  if (corpus.truncated) return [];
  const on: DeclaredOn = declaredOn === 'answer' ? 'answer' : { toolCallId: declaredOn.toolCallId };
  const rows: ContingentRow[] = [];
  const seen = new Set<string>();
  for (const { value, forms } of values) {
    const canonical = canonicalForm(value);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const carriers = carriersOf(forms, corpus.carriers);
    if (carriers === undefined || carriers.length === 0) continue;
    const judged: ContingentCarrier[] = [];
    let stands = false;
    for (const toolCallId of carriers) {
      const row = standingOf.get(toolCallId);
      // Undeclared, or stood on: the value stands, whatever the others say.
      if (row === undefined || !SET_ASIDE.includes(row.standing)) {
        stands = true;
        break;
      }
      judged.push({ toolCallId, standing: row.standing });
    }
    if (stands) continue;
    rows.push({
      kind: 'contingent',
      declaredOn: on,
      value: clipValue(value),
      carriers: judged,
      iteration,
    });
  }
  return rows;
}

/**
 * Every result that carried any of the spellings looked up, each once, in
 * the order the corpus listed them; `undefined` when any spelling's list
 * was cut — the rule needs the whole list or none.
 */
function carriersOf(
  forms: readonly string[],
  carriers: ReadonlyMap<
    string,
    { readonly toolCallIds: readonly string[]; readonly truncated?: true }
  >,
): string[] | undefined {
  const out: string[] = [];
  for (const form of forms) {
    const entry = carriers.get(form);
    if (entry === undefined) continue;
    if (entry.truncated === true) return undefined;
    for (const id of entry.toolCallIds) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The one cut a contingent value gets — the `ledger.ts · clipText` law at `CONTINGENT_VALUE_CHARS`. */
function clipValue(value: string): string {
  if (value.length <= CONTINGENT_VALUE_CHARS) return value;
  return `${value.slice(0, CONTINGENT_VALUE_CHARS)} …[clipped ${
    value.length - CONTINGENT_VALUE_CHARS
  } chars]`;
}
