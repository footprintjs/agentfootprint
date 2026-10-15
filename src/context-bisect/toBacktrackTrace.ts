/**
 * toBacktrackTrace — serialize a ContextBugReport into the BacktrackTrace
 * shape that agentThinkingUI's <BacktrackView>/<BacktrackOverlay> renders
 * (the "why?" board: suspects → influence meters → ablation stamps →
 * chain-of-custody rewind).
 *
 * Pure mapping, no UI dependency — the BacktrackTrace interfaces below
 * MIRROR agentthinkingui's `types/index.d.ts` contract; both sides are
 * framework-agnostic JSON. The report carries everything except two
 * things only the caller knows:
 *
 *   - `answer` (REQUIRED): the report localizes a decision but does not
 *     hold the decision's output text — pass what the agent said/chose.
 *   - `custody` (optional): the rewind player replays RECORDED STATE
 *     (the assembled prompt, the mutating commit). That content lives in
 *     the caller's artifacts (snapshot/events), not in the report — pass
 *     a callback to enrich confirmed suspects with evidence panes.
 *
 * Honesty is preserved, not added: ranks are TRUE report positions even
 * when the cards are a subset (`rank`), path-only scores carry
 * `upperBound` (hatched meter + starred value in the UI), honesty flags
 * map verbatim, and the claims-discipline lines ride along. The mapper
 * never invents a causal claim: `verdict` exists only where the report's
 * ablation produced one ('inconclusive' maps to NO stamp, not a verdict).
 */

import type { ContextBugReport, Suspect } from './types.js';

/* ── the agentthinkingui contract (mirrored, dependency-free) ─────────── */

export interface BacktrackCustodyHop {
  readonly step: string;
  readonly detail: string;
  readonly at?: string;
  readonly variable?: string;
  /** recorded state at this hop — prompt text, commit payload, code, rule operands */
  readonly content?: string;
  /** exact substring of `content` highlighted as the culprit span */
  readonly highlight?: string;
}

export interface BacktrackHop {
  readonly key: string;
  readonly kind?: 'data' | 'control';
  readonly via?: string;
}

export interface BacktrackSuspectCard {
  readonly kind: string;
  readonly flavor?: string;
  readonly name: string;
  readonly text?: string;
  readonly score: number;
  /** true position in the report's ranking (cards may be a subset) */
  readonly rank: number;
  /** score is a path-only upper bound — no content signal */
  readonly upperBound?: boolean;
  /** the hop adjacent to the suspect (what fed the decision side) */
  readonly edge?: {
    readonly key?: string;
    readonly weight?: number;
    readonly kind?: 'data' | 'control';
  };
  /** the full hop chain, decision → suspect (multi-hop paths only) */
  readonly path?: readonly BacktrackHop[];
  readonly bornAt?: { readonly id: string; readonly label?: string; readonly via?: string };
  readonly custody?: readonly BacktrackCustodyHop[];
  readonly verdict?: {
    readonly kind: 'confirmed' | 'not-confirmed';
    readonly flips?: number;
    readonly samples?: number;
    readonly claim?: string;
  };
}

export interface BacktrackTrail {
  readonly title?: string;
  readonly custody?: readonly BacktrackCustodyHop[];
  readonly claim?: string;
}

export interface BacktrackTrace {
  readonly claim: string;
  readonly mode: 'causal' | 'correlational';
  readonly modeLabel?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly answer: {
    readonly text: string;
    readonly label?: string;
    readonly tone?: 'error' | 'question';
  };
  readonly decidedAt: {
    readonly id: string;
    readonly label?: string;
    readonly kind?: 'llm' | 'rule';
  };
  readonly suspects: readonly BacktrackSuspectCard[];
  readonly trail?: BacktrackTrail;
  readonly folded?: string;
  readonly scoreNote?: string;
  readonly baseline?: string;
  readonly honesty?: readonly string[];
}

/* ── options ──────────────────────────────────────────────────────────── */

export interface ToBacktrackTraceOptions {
  /** The decision's output text — the report doesn't hold it. */
  readonly answer: {
    readonly text: string;
    readonly label?: string;
    readonly tone?: 'error' | 'question';
  };
  /** Headline question. Default: derived from the trigger step. */
  readonly claim?: string;
  /** 'rule' renders the decision diamond instead of the brain. Default 'llm'. */
  readonly decidedAtKind?: 'llm' | 'rule';
  /** Override the mode chip (e.g. "exact chain · proxy ranking"). */
  readonly modeLabel?: string;
  readonly agent?: string;
  readonly model?: string;
  /** Max suspect cards. Default 6. The rest fold into one disclosed line. */
  readonly maxSuspects?: number;
  /**
   * Card selection when the report has more suspects than `maxSuspects`.
   * Default TRUE: content-evidence suspects fill the cards first (they are
   * what a human can act on), structural path-only hops fold — but every
   * card keeps its TRUE report rank, and the folded line discloses what
   * was left out and that it ranked where it ranked. FALSE: strictly the
   * report's top-N.
   */
  readonly preferContentEvidence?: boolean;
  /** Enrich a suspect's chain of custody with recorded-state panes. */
  readonly custody?: (
    suspect: Suspect,
    trueRank: number,
  ) => readonly BacktrackCustodyHop[] | undefined;
  /** Exact recorded hops for deterministic decisions (no ablation verdict). */
  readonly trail?: BacktrackTrail;
  /** Override the auto score note (top-2 margin tie warning). */
  readonly scoreNote?: string;
}

/* ── mapping ──────────────────────────────────────────────────────────── */

const BORN_VIA: Record<string, string | undefined> = {
  injection: 'injection engine',
  tool: 'tool result',
  arg: 'run args/env (untracked)',
  stage: 'stage commit',
};

/** The report's claims-discipline lines — same tier language as formatContextBugReport. */
const CLAIMS_LINES: readonly string[] = [
  'scores/weights are deterministic embedding-geometry proxies — semantic alignment, not model internals.',
  'only ablation verdicts make causal claims.',
];

function suspectName(s: Suspect): string {
  return s.detail?.injectionId ?? s.detail?.toolName ?? s.source;
}

function toCard(
  s: Suspect,
  trueRank: number,
  custody?: ToBacktrackTraceOptions['custody'],
): BacktrackSuspectCard {
  // edgePath walks decision → suspect; the suspect-adjacent hop is last
  const adjacent = s.edgePath.length > 0 ? s.edgePath[s.edgePath.length - 1] : undefined;
  const verdict =
    s.verdict && s.verdict.verdict !== 'inconclusive'
      ? {
          kind: s.verdict.verdict,
          flips: s.runs?.flips,
          samples: s.runs?.samples,
          claim: s.verdict.claim,
        }
      : undefined;
  return {
    kind: s.kind,
    flavor: s.detail?.flavor,
    name: suspectName(s),
    text: s.detail?.text,
    score: s.score,
    rank: trueRank,
    upperBound: s.hasContentEvidence ? undefined : true,
    edge: adjacent
      ? { key: adjacent.key, weight: adjacent.weight, kind: adjacent.kind }
      : undefined,
    path:
      s.edgePath.length > 1
        ? s.edgePath.map((h) => ({
            key: h.key ?? '',
            kind: h.kind,
            via: `${h.from} ← ${h.to}`,
          }))
        : undefined,
    bornAt: { id: s.source, label: s.stageName, via: BORN_VIA[s.kind] },
    custody: custody?.(s, trueRank),
    verdict,
  };
}

/**
 * Serialize a localizer report for agentThinkingUI's BacktrackView.
 * See module doc — `answer` is required; `custody` enriches the rewind.
 */
export function toBacktrackTrace(
  report: ContextBugReport,
  opts: ToBacktrackTraceOptions,
): BacktrackTrace {
  const max = opts.maxSuspects ?? 6;
  const prefer = opts.preferContentEvidence ?? true;

  // selection — true report rank rides on every card either way
  const indexed = report.suspects.map((s, i) => ({ s, trueRank: i + 1 }));
  let selected: typeof indexed;
  if (indexed.length <= max) {
    selected = indexed;
  } else if (prefer) {
    const content = indexed.filter((e) => e.s.hasContentEvidence);
    const structural = indexed.filter((e) => !e.s.hasContentEvidence);
    selected = [...content, ...structural].slice(0, max);
    selected.sort((a, b) => a.trueRank - b.trueRank); // cards stay in rank order
  } else {
    selected = indexed.slice(0, max);
  }

  const selectedRanks = new Set(selected.map((e) => e.trueRank));
  const dropped = indexed.filter((e) => !selectedRanks.has(e.trueRank));
  const folded =
    dropped.length > 0
      ? `${dropped.length} more suspect${dropped.length === 1 ? '' : 's'} folded — ` +
        dropped.map((e) => `#${e.trueRank} ${e.s.source}`).join(' · ') +
        (dropped.every((e) => !e.s.hasContentEvidence) ? ' (path-only upper bounds)' : '') +
        ' — every id drillable with the trace toolpack'
      : undefined;

  // auto tie-warning: only when the report's top two genuinely crowd each other
  let scoreNote = opts.scoreNote;
  if (scoreNote === undefined && report.suspects.length >= 2) {
    const margin = report.suspects[0].score - report.suspects[1].score;
    if (margin < 0.05) {
      scoreNote = `top-2 margin ${margin.toFixed(2)} — proxy scores alone cannot separate them${
        report.mode === 'causal' ? '; the ablation test can' : ''
      }.`;
    }
  }

  // When the decision being walked back is a deterministic rule (decidedAtKind:
  // 'rule'), having no LLM-call ids is EXPECTED, not a missing input: a rule makes
  // no model calls, so "structure-only ranking" is the correct mode. The localizer
  // can't tell that case from "an LLM chart whose llmCallIds weren't passed" — only
  // the consumer's decidedAtKind disambiguates — so we reframe that one flag here,
  // at the layer that knows. It becomes a neutral note (no ⚠), never a warning.
  const decidedAtKind = opts.decidedAtKind ?? 'llm';
  const honesty = [
    ...report.honestyFlags.map((f) =>
      decidedAtKind === 'rule' && f.flag === 'no-llm-call-ids'
        ? 'this decision is a deterministic rule — it makes no LLM calls, so scores rank recorded operands by structure (no influence weighting applies).'
        : `⚠ ${f.flag}: ${f.note}`,
    ),
    ...CLAIMS_LINES,
  ];

  return {
    claim: opts.claim ?? `Why did ${report.stepName} (${report.step}) decide this?`,
    mode: report.mode,
    modeLabel: opts.modeLabel,
    agent: opts.agent,
    model: opts.model,
    answer: opts.answer,
    decidedAt: { id: report.step, label: report.stepName, kind: decidedAtKind },
    suspects: selected.map((e) => toCard(e.s, e.trueRank, opts.custody)),
    trail: opts.trail,
    folded,
    scoreNote,
    baseline: report.baseline
      ? `${report.baseline.flips}/${report.baseline.samples} flipped with no ablation`
      : undefined,
    honesty,
  };
}
