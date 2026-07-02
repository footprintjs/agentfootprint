/**
 * sliceToBacktrackTrace — serialize a footprintjs VARIABLE SLICE
 * (`sliceToJSON(sliceForKey(...))` from `footprintjs/trace`) into the
 * BacktrackTrace shape agentThinkingUI's <BacktrackView>/<BacktrackOverlay>
 * renders.
 *
 * The sibling of {@link toBacktrackTrace}: that one maps a LOCALIZER REPORT
 * (scored suspects, ablation verdicts); this one maps a STRUCTURAL SLICE —
 * the exact dependency chain behind one variable, with no influence claims
 * at all. Same board, honestly weaker chips:
 *
 *   - `mode` is ALWAYS 'correlational' — a slice is exact STRUCTURE, but it
 *     never tested influence; the default modeLabel says exactly that.
 *   - every card is `upperBound: true` (the UI's hatched meter + star): the
 *     score is 1/(1+depth) — hop PROXIMITY, a deterministic layout aid, not
 *     evidence. The honesty lines state the formula so nobody reads it as
 *     influence.
 *   - slice honesty rides along verbatim: reads-coverage warning
 *     (readTracking off), truncation, per-node incomplete-sources counts,
 *     and honest ABSENCE — a missing slice renders an empty board whose
 *     honesty lines say why ('never written' → initial state / frozen args /
 *     closure), never a fabricated suspect.
 *
 * Pure mapping, no UI dependency, framework-agnostic JSON on both sides —
 * the human and the LLM triage the SAME artifact (the parity loop: an agent
 * emits this, a person confirms or overrides on the board).
 */

import type { SliceJSON } from 'footprintjs/trace';

import type {
  BacktrackHop,
  BacktrackSuspectCard,
  BacktrackTrace,
} from './toBacktrackTrace.js';

export interface SliceToBacktrackTraceOptions {
  /** The visible outcome being questioned (the board's answer bubble). */
  readonly answer: {
    readonly text: string;
    readonly label?: string;
    readonly tone?: 'error' | 'question';
  };
  /** Headline question. Default: `Why is '<key>' what it is?`. */
  readonly claim?: string;
  /** How the anchor writer renders: rule diamond or LLM brain. Default 'rule'. */
  readonly decidedAtKind?: 'llm' | 'rule';
  /** Override the mode chip label. */
  readonly modeLabel?: string;
  readonly agent?: string;
  readonly model?: string;
  /** Max suspect cards. Default 6. The rest fold into one disclosed line. */
  readonly maxSuspects?: number;
}

/** The structural-honesty lines every slice board carries. */
const SLICE_CLAIMS_LINES: readonly string[] = [
  'scores are hop proximity (1/(1+depth)) — a layout aid, not influence; every card is a path-only upper bound.',
  'this board shows exact dependency STRUCTURE; only ablation verdicts make causal claims.',
];

/**
 * Shortest hop chain root → node over the slice's id-referenced edges
 * (BFS; edges point child→parent, i.e. away from the root).
 */
function pathTo(json: SliceJSON, targetId: string): BacktrackHop[] | undefined {
  if (!json.edges || !json.writerId || targetId === json.writerId) return undefined;
  const prev = new Map<string, { from: string; key?: string; kind?: 'data' | 'control' }>();
  const queue = [json.writerId];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === targetId) break;
    for (const e of json.edges) {
      if (e.from !== cur || seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, { from: e.from, key: e.key, kind: e.kind });
      queue.push(e.to);
    }
  }
  if (!prev.has(targetId)) return undefined;
  const hops: BacktrackHop[] = [];
  let cur = targetId;
  while (cur !== json.writerId) {
    const p = prev.get(cur)!;
    hops.unshift({ key: p.key ?? '', kind: p.kind, via: `${p.from} ← ${cur}` });
    cur = p.from;
  }
  return hops.length > 1 ? hops : undefined;
}

/**
 * Serialize a variable slice for agentThinkingUI's BacktrackView. See the
 * module doc — structural honesty is the whole design.
 */
export function sliceToBacktrackTrace(
  json: SliceJSON,
  opts: SliceToBacktrackTraceOptions,
): BacktrackTrace {
  const max = opts.maxSuspects ?? 6;
  const claim = opts.claim ?? `Why is '${json.key}' what it is?`;

  const honesty: string[] = [];
  if (json.missing === 'never-written') {
    honesty.push(
      `⚠ '${json.key}' was never written in this run — the value came from initial state, frozen run input (args), or a closure; the commit log cannot see those.`,
    );
  } else if (json.missing === 'empty-log') {
    honesty.push('⚠ the commit log is empty — nothing executed.');
  }
  if (json.readsCoverage && json.readsCoverage.steps > 1 && json.readsCoverage.stepsWithReads === 0) {
    honesty.push(
      '⚠ reads were not recorded (readTracking off) — upstream dependencies are unknowable, NOT absent.',
    );
  }
  if (json.truncated) {
    honesty.push(
      `⚠ slice truncated (${[json.truncated.byDepth && 'depth', json.truncated.byNodes && 'node budget']
        .filter(Boolean)
        .join(' + ')}) — older causes exist beyond this horizon.`,
    );
  }

  // Honest absence: an empty board whose honesty says why.
  if (!json.writerId || !json.nodes) {
    return {
      claim,
      mode: 'correlational',
      modeLabel: opts.modeLabel ?? 'no slice — see honesty',
      agent: opts.agent,
      model: opts.model,
      answer: opts.answer,
      decidedAt: { id: json.key, label: `'${json.key}' (no recorded writer)`, kind: opts.decidedAtKind ?? 'rule' },
      suspects: [],
      honesty: [...honesty, ...SLICE_CLAIMS_LINES],
    };
  }

  const writer = json.nodes[json.writerId];
  let incompleteCount = 0;

  // Non-root nodes in their BFS insertion order (sliceToJSON preserves it).
  const entries = Object.entries(json.nodes).filter(([id]) => id !== json.writerId);
  const cards: BacktrackSuspectCard[] = entries.map(([id, node], i) => {
    if (node.incompleteSources && node.incompleteSources.length > 0) incompleteCount++;
    const inboundEdge = json.edges?.find((e) => e.to === id);
    return {
      kind: 'stage',
      name: node.stageName,
      score: Number((1 / (1 + node.depth)).toFixed(2)),
      rank: i + 1,
      upperBound: true,
      edge: inboundEdge
        ? { key: inboundEdge.key, weight: inboundEdge.weight, kind: inboundEdge.kind }
        : undefined,
      path: pathTo(json, id),
      bornAt: { id, label: node.stageName, via: 'stage commit' },
    };
  });

  if (incompleteCount > 0) {
    honesty.push(
      `⚠ ${incompleteCount} step${incompleteCount === 1 ? '' : 's'} in the chain also consumed untracked inputs (args/env/silent reads) — the slice may be incomplete there.`,
    );
  }

  const selected = cards.slice(0, max);
  const dropped = cards.slice(max);
  const folded =
    dropped.length > 0
      ? `${dropped.length} more step${dropped.length === 1 ? '' : 's'} folded — ` +
        dropped.map((c) => `#${c.rank} ${c.bornAt!.id}`).join(' · ') +
        ' — every id drillable with the trace toolpack'
      : undefined;

  return {
    claim,
    mode: 'correlational',
    modeLabel: opts.modeLabel ?? 'exact dependency chain — structural, not ablation-tested',
    agent: opts.agent,
    model: opts.model,
    answer: opts.answer,
    decidedAt: {
      id: json.writerId,
      label: writer?.stageName,
      kind: opts.decidedAtKind ?? 'rule',
    },
    suspects: selected,
    folded,
    honesty: [...honesty, ...SLICE_CLAIMS_LINES],
  };
}
