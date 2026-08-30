/**
 * runbook/verdicts — the OPTIONAL verdict/rowset projection.
 *
 * Pattern: pure selection + rendering over the run's final state, plus one
 *          tiny recorder that harvests decide() evidence for generated
 *          meanings. Selected by `resultKind: 'verdict/*'`; a runbook of any
 *          other kind never sees this module.
 * Role:    core/runbook.
 * Emits:   N/A.
 *
 * THE ONE-NUMBER LAW: the rendered table and the structured `verdicts` list
 * show the SAME rows under the SAME cap. A rendered table beside a longer
 * structured list is an invitation that gets accepted — rows come back
 * retyped with subtly wrong identifiers.
 *
 * TWO SURFACES, TWO LAWS: a rowset does not always reach its reader through
 * the model's prose. Where it does, the table ships pre-rendered and the model
 * is told to output it verbatim (`VERDICT_RENDER_NOTE`); where the HOST draws
 * the rowset itself, no table ships and the model is told the opposite
 * (`PANEL_RENDER_NOTE`). The bridge cannot tell which client it is in, so the
 * caller says — `presentation` on the options bag.
 *
 * GENERATED MEANINGS, never hand-restated: `verdict_meanings` is composed
 * from (a) the named decider's declared branches in the chart's own structure
 * (branch description, falling back to branch name), overlaid by (b) the rule
 * LABELS this run's decide() evidence carried — the rule speaking for itself —
 * and (c) the DEFAULT branch's declared label, carried by the same evidence.
 * A decider inside a dynamically generated fan-out branch is invisible to (a)
 * by construction (the branch chart does not exist at build time); (b) still
 * covers every verdict an executed rule produced.
 *
 * (c) exists because the default branch is chosen by NO rule — it fires
 * exactly when every rule failed, so it appears in no `rules[]` entry and (b)
 * can never name it. In a generated fan-out branch, where (a) is blind too, it
 * was the one verdict the rowset could show and the meanings map could not
 * explain. `decide(scope, rules, { branch, label })` (footprintjs ≥ 9.16.1) puts
 * that label on the decision evidence, so it arrives here the way every other
 * label does: harvested from the run, never declared at this boundary. There is
 * deliberately no caller-supplied meanings map — a map a caller can write is a
 * map that can describe rules that never ran.
 */

import type { CombinedRecorder, FlowDecisionEvent } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { VerdictRow } from './types.js';

/** Default cap on `verdicts` rows and the rendered table. */
export const DEFAULT_MAX_ROWS = 50;

/** The render law when PROSE is the rowset's only surface (`presentation:
 *  'prose'`, the default) — stated to the model beside the table. */
export const VERDICT_RENDER_NOTE =
  'table is PRE-RENDERED over the same rows as `verdicts` — output it VERBATIM. Never ' +
  'retype an identifier from `verdicts`; a transcribed name that looks right and matches ' +
  'nothing is the failure this note exists to stop.';

/**
 * The render law when the HOST renders the rowset (`presentation: 'panel'`) —
 * stated to the model INSTEAD of a table, because there is none to ship.
 *
 * Same failure, opposite instruction. A rowset the reader can already see does
 * not need retyping into prose; retyping it is how an identifier arrives
 * subtly wrong beside a correct one on screen.
 */
export const PANEL_RENDER_NOTE =
  "the rows in `verdicts` are ALREADY on the reader's screen — this host renders the " +
  'rowset itself, so no table is shipped here. Do NOT reproduce those rows in prose in ' +
  'any form: not as a table, not as bullets, not as one sentence per row. When a finding ' +
  'names a row, quote the evidence sentence that row carries VERBATIM, and cite only the ' +
  'values the finding rests on, copied byte-for-byte. A retyped identifier that looks ' +
  'right and matches nothing is the failure this note exists to stop.';

/** The reserved verdict word for "no classification was reached" — rows
 *  carrying it are counted into the coverage ledger as not-checked ground
 *  (the three-outcome honesty: reached, reached-and-clear, DECLINED). */
export const DECLINED_VERDICT = 'declined';

/** Read the rowset off the final state's `verdicts` key — an array of bags
 *  each carrying a string `verdict`. Anything else reads as "no rowset". */
export function verdictRowsOf(state: Readonly<Record<string, unknown>>): VerdictRow[] {
  const raw = state.verdicts;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (row): row is VerdictRow =>
      row !== null &&
      typeof row === 'object' &&
      !Array.isArray(row) &&
      typeof (row as { verdict?: unknown }).verdict === 'string',
  );
}

/** The one place a `—` is written for a value the source did not report — a
 *  blank cell reads as a zero; a dash reads as "not reported". */
function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Render the shown rows as one markdown table. Columns are the FIRST row's
 * own keys in declaration order — the chart writes its rows, so the chart
 * owns the column vocabulary; the bridge only renders it.
 */
export function renderVerdictTable(rows: readonly VerdictRow[]): string {
  if (rows.length === 0) return 'No rows in the projected set.';
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const columns = Object.keys(rows[0]!);
  const head = `| ${columns.join(' | ')} |\n|${columns.map(() => '---').join('|')}|\n`;
  return (
    head +
    rows.map((row) => `| ${columns.map((column) => cell(row[column])).join(' | ')} |`).join('\n')
  );
}

// ─── Generated meanings ────────────────────────────────────────────────────

/** A minimal structural view of a chart node — enough to find a decider and
 *  read its branches without importing engine internals. */
interface NodeView {
  readonly id?: string;
  readonly name?: string;
  readonly branchId?: string;
  readonly description?: string;
  readonly children?: readonly NodeView[];
  readonly next?: NodeView;
  readonly isLoopRef?: boolean;
}

/** The two spellings of the configured decider, once the static walk has
 *  (maybe) resolved it — flow events report the decider by name. */
export interface DeciderIdentity {
  readonly spellings: ReadonlySet<string>;
  /** branch → declared meaning, from the chart's own structure. */
  readonly declared: ReadonlyMap<string, string>;
}

/**
 * Find the named decider in the chart's static structure (root graph plus
 * statically declared subflows) and read its branches. Loop-ref stubs are
 * skipped FIRST — they deliberately violate node-id uniqueness.
 */
export function resolveDecider(chart: FlowChart, decider: string): DeciderIdentity {
  const spellings = new Set<string>([decider]);
  const declared = new Map<string, string>();
  const visited = new Set<NodeView>();
  const walk = (node: NodeView | undefined): void => {
    if (node === undefined || node.isLoopRef === true || visited.has(node)) return;
    visited.add(node);
    if ((node.id === decider || node.name === decider) && (node.children?.length ?? 0) > 0) {
      if (node.id !== undefined) spellings.add(node.id);
      if (node.name !== undefined) spellings.add(node.name);
      for (const child of node.children ?? []) {
        const branch = child.branchId ?? child.id;
        if (branch === undefined) continue;
        const meaning = child.description ?? child.name;
        if (meaning !== undefined && !declared.has(branch)) declared.set(branch, meaning);
      }
    }
    for (const child of node.children ?? []) walk(child);
    walk(node.next);
  };
  walk(chart.root as NodeView);
  for (const subflow of Object.values(chart.subflows ?? {})) {
    walk(subflow.root as NodeView);
  }
  return { spellings, declared };
}

/** The evidence harvest: rule labels observed in this run, branch → label. */
export interface MeaningsHarvest {
  readonly recorder: CombinedRecorder;
  readonly observed: ReadonlyMap<string, string>;
}

/** A label is a meaning only when it says something — a blank one is recorded
 *  as no meaning at all, never as a verdict that means the empty string. */
function meaningful(label: unknown): label is string {
  return typeof label === 'string' && label.length > 0;
}

/**
 * A tiny flow recorder capturing the named decider's decide() evidence as it
 * fires — collected DURING the traversal, never reconstructed after. Rule
 * labels are harvested for every rule the evidence lists (matched or not):
 * a rule that was evaluated has spoken its label, whichever branch won. The
 * DEFAULT branch's label rides the same evidence and is harvested with them.
 *
 * A decider inside a subflow (including a generated fan-out branch) reports
 * itself PATH-PREFIXED (`per-subject~0/Protection posture`), so the match is
 * on the LAST `/`-segment — the same last-delimiter reading every upstream
 * parser of these paths uses, which is what keeps the generated-branch
 * marker opaque here.
 */
export function meaningsRecorder(identity: DeciderIdentity): MeaningsHarvest {
  const observed = new Map<string, string>();
  const lastSegment = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  const recorder = {
    id: 'runbook-verdict-meanings',
    onDecision(event: FlowDecisionEvent): void {
      if (!identity.spellings.has(lastSegment(event.decider))) return;
      const evidence = event.evidence as
        | {
            rules?: readonly { branch?: string; label?: string }[];
            default?: string;
            defaultLabel?: string;
          }
        | undefined;
      // The default first, the rules over it. The default is the branch NO
      // rule chose, so it is normally the only speaker for its own name; where
      // a rule also routes to it, the rule is the sharper sentence and wins.
      if (typeof evidence?.default === 'string' && meaningful(evidence.defaultLabel)) {
        observed.set(evidence.default, evidence.defaultLabel);
      }
      for (const rule of evidence?.rules ?? []) {
        if (typeof rule.branch === 'string' && meaningful(rule.label)) {
          observed.set(rule.branch, rule.label);
        }
      }
    },
  } as unknown as CombinedRecorder;
  return { recorder, observed };
}

/** Compose the final meanings: declared branches first, the labels this run
 *  observed (rule labels, and the default branch's own) winning where both
 *  speak — the declaration made beside the rules is the sharper sentence.
 *  Undefined when neither source produced anything — absent, never `{}`. */
export function composeMeanings(
  identity: DeciderIdentity,
  observed: ReadonlyMap<string, string>,
): Record<string, string> | undefined {
  const meanings: Record<string, string> = {};
  for (const [branch, meaning] of identity.declared) meanings[branch] = meaning;
  for (const [branch, label] of observed) meanings[branch] = label;
  return Object.keys(meanings).length > 0 ? meanings : undefined;
}
