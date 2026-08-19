/**
 * semantics/check — the `check:semantics` gate core (9.53.0).
 *
 * Pattern: humble shell (the tool-lint precedent) — ALL behavior lives here,
 *          unit-tested; `bin/agentfootprint-check-semantics.mjs` only resolves
 *          the built module and maps the exit code. Consumers wire the bin
 *          into their own `check:` scripts beside `check:tools`.
 * Role:    lib/ layer, pure. Judges SAMPLE RESULTS against the semantic
 *          vocabulary and the per-class rules; never executes a tool, never
 *          touches a network — the samples come from the consumer's own mock
 *          tools or fixtures, the same way `check:tools` receives a dumped
 *          catalog.
 * Emits:   N/A.
 *
 * ## Severity follows provability (the skillGraph check-up law)
 *
 * Only what the declaration PROVES wrong is an error:
 *
 *   • a `'triage'` / `'inventory'` tool whose sample result declares no
 *     coverage — the CLASS declared the requirement, the sample violates it;
 *   • a marker-bearing envelope with faults (series without grain, data
 *     without provenance, a counter-looking aggregation with `is_counter`
 *     unstated, malformed shapes) — the marker declared the vocabulary, the
 *     shape violates it.
 *
 * Everything else warns: a classed tool with NO samples (the gate cannot
 * check what it cannot see — but silence must not read as a pass), and an
 * inventory whose facts carry no render hint (useful, not provably harmful).
 */

import { readCoverageResult } from '../../core/agent/coverage/read.js';
import { explainSemantics, readSemantics } from './envelope.js';
import { RESULT_CLASSES, type ToolResultClass } from './types.js';

/**
 * One tool's row in the semantics catalog: its name, its DECLARED result
 * class (from `defineTool({ resultClass })`), and sample results to judge —
 * typically what the consumer's mock tools return, dumped to JSON the same
 * way `check:tools` dumps its catalog.
 */
export interface SemanticsCatalogEntry {
  readonly name: string;
  readonly resultClass?: ToolResultClass;
  readonly results: readonly unknown[];
}

/** Every code one finding can carry. The four envelope codes are the
 *  recognizer's own (`SemanticIssueCode`); the rest are the class rules. */
export type SemanticsFindingCode =
  | 'malformed-semantics'
  | 'series-without-grain'
  | 'counter-aggregation-unstated'
  | 'data-without-provenance'
  | 'triage-without-coverage'
  | 'inventory-without-coverage'
  | 'inventory-without-render'
  | 'unsampled-tool-class';

/** One finding — names the TOOL and the FIELD, so the build log points at
 *  the line to fix, never at the suite. */
export interface SemanticsFinding {
  readonly tool: string;
  readonly code: SemanticsFindingCode;
  readonly severity: 'error' | 'warning';
  /** The offending / missing field, dot-pathed ('coverage', 'grain.is_counter'). */
  readonly field: string;
  /** Which sample result (0-based) — absent for per-tool findings. */
  readonly resultIndex?: number;
  readonly message: string;
}

/** The gate's verdict. `ok` = no errors (warnings never fail it; the CLI's
 *  `--strict` recomputes the exit code over warnings too). */
export interface SemanticsReport {
  readonly ok: boolean;
  readonly findings: readonly SemanticsFinding[];
  readonly checkedTools: number;
  readonly checkedResults: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when a result states its boundary through ANY recognized door: a
 *  semantic envelope with `coverage`, a `coverage()` ledger, or an
 *  `absent()` (whose `checked` IS its coverage). */
function declaresCoverage(result: unknown): boolean {
  const sem = readSemantics(result);
  if (sem !== undefined) return sem.coverage !== undefined;
  return readCoverageResult(result) !== undefined;
}

function classCoverageFinding(entry: SemanticsCatalogEntry, resultIndex: number): SemanticsFinding {
  const cls = entry.resultClass as 'triage' | 'inventory';
  return {
    tool: entry.name,
    code: cls === 'triage' ? 'triage-without-coverage' : 'inventory-without-coverage',
    severity: 'error',
    field: 'coverage',
    resultIndex,
    message:
      `tool '${entry.name}' is declared '${cls}' but sample result ${resultIndex + 1} ` +
      `declares no coverage — field \`coverage\` is required on every ${cls} result. ` +
      (cls === 'triage'
        ? `A triage that cannot say what it did NOT check turns "everything looks fine" into ` +
          `a claim about ground it never stood on. `
        : `An inventory that cannot say which population it covered ("4 of 5 clusters") reads ` +
          `as the whole fleet. `) +
      `Return semantic({ …, coverage: { checked, notChecked, cannotCover } }), or coverage(result, …), ` +
      `or absent({ … }) when nothing was found.`,
  };
}

/**
 * Judge a semantics catalog. Pure; throws only on a malformed CATALOG (a
 * definition-side mistake — the CLI maps it to exit code 2), never on a
 * malformed RESULT (that is a finding, the thing this gate exists to report).
 */
export function checkSemantics(entries: readonly SemanticsCatalogEntry[]): SemanticsReport {
  if (!Array.isArray(entries)) {
    throw new Error('checkSemantics: takes an array of { name, resultClass?, results } entries.');
  }
  const findings: SemanticsFinding[] = [];
  let checkedResults = 0;

  entries.forEach((raw, entryIndex) => {
    if (!isPlainObject(raw)) {
      throw new Error(`checkSemantics: entries[${entryIndex}] is not an object.`);
    }
    const entry = raw as unknown as SemanticsCatalogEntry;
    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      throw new Error(`checkSemantics: entries[${entryIndex}] has no tool name.`);
    }
    const cls = entry.resultClass;
    if (cls !== undefined && !RESULT_CLASSES.includes(cls)) {
      throw new Error(
        `checkSemantics: tool '${entry.name}' declares resultClass '${String(cls)}', which is ` +
          `not a class this library has. The classes are: ${RESULT_CLASSES.join(', ')}. ` +
          `Omit the field for a tool with no class rules.`,
      );
    }
    const results = entry.results;
    if (!Array.isArray(results)) {
      throw new Error(
        `checkSemantics: tool '${entry.name}' has no \`results\` array — the gate judges ` +
          `sample results; give it at least one (your mock tool's return is the natural sample).`,
      );
    }

    if (cls !== undefined && results.length === 0) {
      findings.push({
        tool: entry.name,
        code: 'unsampled-tool-class',
        severity: 'warning',
        field: 'results',
        message:
          `tool '${entry.name}' is declared '${cls}' but no sample results were given — the ` +
          `gate cannot check what it cannot see, and a class rule with no samples is a promise ` +
          `nobody is keeping. Add one sample result (a mock return is enough).`,
      });
    }

    results.forEach((result, resultIndex) => {
      checkedResults += 1;

      // A marker-bearing value with faults: every fault becomes a finding
      // under the recognizer's own code, naming the field.
      const issues = explainSemantics(result);
      if (issues !== undefined) {
        for (const issue of issues) {
          findings.push({
            tool: entry.name,
            code: issue.code,
            severity: 'error',
            field: issue.field,
            resultIndex,
            message: `tool '${entry.name}', sample result ${resultIndex + 1}: ${issue.message}`,
          });
        }
        // An unrecognizable envelope cannot be judged for class rules — the
        // faults above are already errors, and guessing at a broken shape
        // would report the same problem twice under two names.
        return;
      }

      const sem = readSemantics(result);

      // ── The class rules ──
      if ((cls === 'triage' || cls === 'inventory') && !declaresCoverage(result)) {
        findings.push(classCoverageFinding(entry, resultIndex));
      }
      if (
        cls === 'inventory' &&
        sem !== undefined &&
        sem.facts !== undefined &&
        sem.render === undefined
      ) {
        findings.push({
          tool: entry.name,
          code: 'inventory-without-render',
          severity: 'warning',
          field: 'render',
          resultIndex,
          message:
            `tool '${entry.name}', sample result ${resultIndex + 1}: an inventory with ` +
            `\`facts\` and no \`render\` hint — a UI can still draw the rows, but the tool ` +
            `author knows the right columns and sort better than any consumer. Consider ` +
            `render: { default: 'table', columns: […] }.`,
        });
      }
    });
  });

  return {
    ok: !findings.some((f) => f.severity === 'error'),
    findings,
    checkedTools: entries.length,
    checkedResults,
  };
}
