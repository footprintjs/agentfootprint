/**
 * variableToBacktrackTrace — serialize a JOINED VARIABLE LIFE
 * ({@link AgentVariableSlice}, from `traceVariable` / `joinVariableSlice`) onto
 * the same BacktrackTrace board agentThinkingUI's <BacktrackView> renders.
 *
 * The third sibling of that board, and the most literal one:
 *   - `toBacktrackTrace`      — a LOCALIZER REPORT (scored suspects, ablation
 *     verdicts): proxy ranking, causal stamps.
 *   - `sliceToBacktrackTrace` — a footprintjs DEPENDENCY SLICE: exact
 *     structure, no influence claims.
 *   - THIS ONE — one variable's recorded LIFE: every write and every read, in
 *     commit order, labeled with the loop it happened in and the agent source
 *     it introduced.
 *
 * Same board, honestly weakest chips:
 *   - `mode` is ALWAYS `'correlational'`. Nothing here was ablated — the join
 *     measures nothing — so the causal chip is unreachable by construction.
 *   - every card is `upperBound: true`: the score is `1/(1+age)` over write
 *     recency, a deterministic LAYOUT AID, not evidence of anything.
 *   - the claims lines say out loud that these moments are STRUCTURAL FACTS —
 *     recorded reads and writes — so a reader can tell this board apart from an
 *     influence board at a glance.
 *   - footprintjs's honesty notes ride along verbatim, and honest ABSENCE
 *     renders an empty board that says why, never a fabricated suspect.
 *
 * Pure mapping, no UI dependency, framework-agnostic JSON on both sides — the
 * human and the LLM triage the SAME artifact.
 */

import type {
  BacktrackCustodyHop,
  BacktrackSuspectCard,
  BacktrackTrace,
} from './toBacktrackTrace.js';
import type { AgentKeyMoment, AgentVariableSlice } from './variable-recall.js';

export interface VariableToBacktrackTraceOptions {
  /** The visible outcome being questioned (the board's answer bubble). */
  readonly answer: {
    readonly text: string;
    readonly label?: string;
    readonly tone?: 'error' | 'question';
  };
  /** Headline question. Default: `What happened to '<key>'?`. */
  readonly claim?: string;
  /** How the latest writer renders: rule diamond or LLM brain. Default 'rule'. */
  readonly decidedAtKind?: 'llm' | 'rule';
  /** Override the mode chip label. */
  readonly modeLabel?: string;
  readonly agent?: string;
  readonly model?: string;
  /** Max suspect cards (one per write). Default 6. The rest fold into one line. */
  readonly maxSuspects?: number;
}

/** The claims-discipline lines every variable board carries. */
const VARIABLE_CLAIMS_LINES: readonly string[] = [
  'every row here is a STRUCTURAL FACT — a recorded read or write from the commit log, not a similarity guess.',
  'scores are write recency (1/(1+age)) — a layout aid, not influence; every card is an upper bound.',
  'only ablation verdicts make causal claims; nothing on this board has been ablated.',
];

/** One custody hop per moment — the recorded rewind rail, in commit order. */
function custodyHop(key: string, m: AgentKeyMoment): BacktrackCustodyHop {
  const where = m.loopIndex !== undefined ? `loop ${m.loopIndex}` : 'run setup (no loop)';
  const detail =
    m.kind === 'write'
      ? `${m.stageName} wrote '${key}'${m.verb !== undefined ? ` (${m.verb})` : ''} — ${where}` +
        (m.suspectId !== undefined ? ` · introduced ${m.suspectKind} '${m.suspectId}'` : '')
      : `${m.stageName} read '${key}'${
          m.fromWriteIdx !== undefined
            ? ` (the value written at commit ${m.fromWriteIdx})`
            : ' (a value from before the log — initial state / run input / a closure)'
        } — ${where}`;
  return { step: m.kind, detail, at: m.runtimeStageId, variable: key };
}

/**
 * Serialize a joined variable life for agentThinkingUI's BacktrackView.
 * See the module doc — structural honesty is the whole design.
 */
export function variableToBacktrackTrace(
  agentSlice: AgentVariableSlice,
  opts: VariableToBacktrackTraceOptions,
): BacktrackTrace {
  const max = opts.maxSuspects ?? 6;
  const key = agentSlice.key;
  const claim = opts.claim ?? `What happened to '${key}'?`;

  const honesty: string[] = [];
  if (agentSlice.missing === 'never-written') {
    honesty.push(
      `⚠ '${key}' was never written in this run — the value came from initial state, frozen run input (args), or a closure; the commit log cannot see those.`,
    );
  } else if (agentSlice.missing === 'empty-log') {
    honesty.push('⚠ the commit log is empty — nothing executed.');
  }
  // footprintjs's own notes, VERBATIM (never re-worded, never dropped).
  for (const note of agentSlice.notes) honesty.push(`⚠ ${note.detail}`);
  if (
    agentSlice.readsCoverage &&
    agentSlice.readsCoverage.steps > 1 &&
    agentSlice.readsCoverage.stepsWithReads === 0
  ) {
    honesty.push(
      '⚠ reads were not recorded (readTracking off) — who consumed this value is unknowable, NOT nobody.',
    );
  }
  honesty.push(
    agentSlice.coverage === 'exact'
      ? "this key's dataflow is recorded per-write (writeProvenance: 'reads-prefix') — what it fed is exact, not inferred."
      : agentSlice.coverage === 'conservative'
      ? "this key's dataflow is stage-level only — what it fed is a sound over-approximation; turn on writeProvenance: 'reads-prefix' for exact edges."
      : "this key has no recorded dataflow (nothing read it, or no forward slice was supplied) — 'what it fed' is unknown here, not empty.",
  );

  const writes = agentSlice.moments.filter((m) => m.kind === 'write');

  // Honest absence: an empty board whose honesty says why.
  if (writes.length === 0) {
    return {
      claim,
      mode: 'correlational',
      modeLabel: opts.modeLabel ?? 'no recorded writes — see honesty',
      agent: opts.agent,
      model: opts.model,
      answer: opts.answer,
      decidedAt: {
        id: key,
        label: `'${key}' (no recorded writer)`,
        kind: opts.decidedAtKind ?? 'rule',
      },
      suspects: [],
      honesty: [...honesty, ...VARIABLE_CLAIMS_LINES],
    };
  }

  // Latest write first — the value's current author is the board's decision point.
  const latest = writes[writes.length - 1];
  const ordered = [...writes].reverse();
  const cards: BacktrackSuspectCard[] = ordered.map((w, age) => {
    const readers = agentSlice.moments.filter(
      (m) => m.kind === 'read' && m.fromWriteIdx === w.commitIdx,
    );
    return {
      kind: w.suspectKind ?? 'stage',
      name: w.suspectId ?? w.stageName,
      score: Number((1 / (1 + age)).toFixed(2)),
      rank: age + 1,
      upperBound: true,
      edge: { key, kind: 'data' as const },
      bornAt: {
        id: w.runtimeStageId,
        label: w.stageName,
        via: w.loopIndex !== undefined ? `loop ${w.loopIndex} commit` : 'run setup commit',
      },
      custody: [custodyHop(key, w), ...readers.map((r) => custodyHop(key, r))],
    };
  });

  const selected = cards.slice(0, max);
  const dropped = cards.slice(max);
  const folded =
    dropped.length > 0
      ? `${dropped.length} more write${dropped.length === 1 ? '' : 's'} folded — ` +
        dropped.map((c) => `#${c.rank} ${c.bornAt!.id}`).join(' · ') +
        ' — every id drillable with the trace toolpack'
      : undefined;

  return {
    claim,
    mode: 'correlational',
    modeLabel: opts.modeLabel ?? 'recorded life of a variable — structure, not influence',
    agent: opts.agent,
    model: opts.model,
    answer: opts.answer,
    decidedAt: {
      id: latest.runtimeStageId,
      label: latest.stageName,
      kind: opts.decidedAtKind ?? 'rule',
    },
    suspects: selected,
    trail: {
      title: `'${key}' — every recorded write and read`,
      custody: agentSlice.moments.map((m) => custodyHop(key, m)),
      claim: 'commit-log facts in order; no influence was measured.',
    },
    folded,
    honesty: [...honesty, ...VARIABLE_CLAIMS_LINES],
  };
}
