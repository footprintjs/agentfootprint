/**
 * runbook/report — the chart's own `report` bag, admitted UNDER the envelope.
 *
 * Pattern: one pure partition (admitted fields / refused names) plus the
 *          sentence that names what was refused. No behavior beyond the law.
 * Role:    core/runbook. `runbookAsTool.ts` consumes at assembly time.
 * Emits:   N/A.
 *
 * THE PRECEDENCE LAW: the names the envelope itself assembles — the honesty
 * spine, and the projection keys this run actually produced — are RESERVED.
 * A chart's `report` may add fields BESIDE them; it may never replace one.
 * The spine is the boundary of the answer, and a boundary a chart can
 * overwrite is a boundary that reports whatever the chart says about itself:
 * a seeded number could arrive stamped as a sourced one, or an answer
 * produced under one reading of the rules could name a version it never ran.
 * A `report` key spelled `af_coverage` is refused too — it lands one level
 * under the real ledger, which is exactly where a decoy would want to sit.
 *
 * AND WHY THE REFUSAL IS SPOKEN, not silent: every other reduction this
 * envelope performs is declared out loud — the walk's `projection`, the
 * rowset's `rows_complete`, declined rows counted into the ledger. Dropping
 * a field the chart wrote with no trace would be the one silent edit in an
 * envelope whose whole argument is that reductions are declared, and the
 * author would debug "where did my field go?" against a shape that never
 * mentions it. So a collision costs one `report_note` naming every refused
 * field — present ONLY when something was actually refused, so the clean
 * path (every real runbook) pays nothing.
 */

/** The ledger's key. It lives at the ENVELOPE's top level, and is reserved
 *  inside `result` too — see the module header. */
export const LEDGER_KEY = 'af_coverage';

/** The key the refusal note ships under — itself reserved, because a
 *  chart-authored `report_note` is a forged receipt for a refusal that
 *  never happened. */
export const REPORT_NOTE_KEY = 'report_note';

/** The chart's `report`, partitioned against the names the envelope owns. */
export interface AdmittedReport {
  /** The fields that may be spread into `result`, in the chart's own order. */
  readonly fields: Record<string, unknown>;
  /** The names refused, in the chart's own order — empty on the clean path. */
  readonly refused: readonly string[];
}

/**
 * Partition the chart's `report` against the names this envelope assembled.
 * `assembled` is read from the actual spine and projection objects, never
 * from a hand-listed copy — a spine field added later is protected the day
 * it lands.
 */
export function admitReport(
  report: Readonly<Record<string, unknown>>,
  assembled: Iterable<string>,
): AdmittedReport {
  const reserved = new Set<string>([LEDGER_KEY, REPORT_NOTE_KEY, ...assembled]);
  // Own enumerable string keys, DEFINED not assigned — the same two rules the
  // spread this replaced followed, so an admitted field lands exactly as it
  // used to (a `__proto__` key stays a key instead of reaching a setter).
  const entries = Object.entries(report);
  return {
    fields: Object.fromEntries(entries.filter(([key]) => !reserved.has(key))),
    refused: entries.filter(([key]) => reserved.has(key)).map(([key]) => key),
  };
}

/** The sentence for a refused collision: which fields were discarded, whose
 *  the surviving values are, and what is safe to read. */
export function shadowedFieldsNote(refused: readonly string[]): string {
  const names = refused.map((name) => `\`${name}\``).join(', ');
  return (
    `${refused.length} field(s) the chart's \`report\` wrote were DISCARDED: ${names}. ` +
    `Those names belong to this envelope — the honesty spine (\`af_coverage\`, ` +
    `\`af_provenance\`, \`rule_version\`, \`walk\`) and the projection this run ` +
    `assembled — so the values you are reading under them are the bridge's, not the ` +
    `chart's. A report adds fields beside the spine; it never replaces one. Every ` +
    `other report field is here verbatim.`
  );
}
