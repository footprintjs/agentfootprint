/**
 * context-ledger/gates.ts — L2: the ledger's rows feed what gets included.
 *
 * Three gates, one policy, each hooking an EXISTING seam (no new framework
 * surface): `gatedTools(inner, predicate)` for tools, `skillGraph().entryBy`
 * for skills, and a rule-trigger wrapper for injections.
 *
 * THE POLICY PRINCIPLE — demote, never starve: a piece the ledger judges
 * poorly is demoted, but every `refreshEvery`-th decision lets it through
 * anyway ("parole"), so it keeps generating fresh ledger data. Without
 * parole a piece demoted once could never earn again — a self-fulfilling
 * verdict. And the ledger never judges a piece it barely knows: below
 * `minOffers` everything passes.
 */

import { rankEntries } from '../injection-engine/entryScorer.js';
import type {
  EntryScorer,
  EntryScorerInput,
  EntryScoring,
} from '../injection-engine/entryScorer.js';
import type { Injection } from '../injection-engine/types.js';
import type { ToolGatePredicate } from '../../tool-providers/types.js';
import type { ContextLedger, PieceKind } from './types.js';

/**
 * When the ledger is allowed to judge, and how harshly.
 * Plain-named knobs — a bookkeeper's rules, not ML hyperparameters.
 */
export interface LedgerPolicy {
  /** Don't judge a piece until it has been offered this many times. Default 5. */
  readonly minOffers?: number;
  /** Demote below this used÷offered rate. Default 0.05 (essentially "never used"). */
  readonly earnRateFloor?: number;
  /**
   * Parole: let a demoted piece through anyway every Nth demotion decision,
   * so it keeps earning fresh data. Default 10. `Infinity` disables parole
   * (NOT recommended — a starved piece can never redeem itself).
   */
  readonly refreshEvery?: number;
}

const DEFAULTS: Required<LedgerPolicy> = { minOffers: 5, earnRateFloor: 0.05, refreshEvery: 10 };

/**
 * The shared verdict: should this piece be included right now?
 * Stateful per gate instance (the parole counter), pure otherwise.
 */
function makeVerdict(
  ledger: ContextLedger,
  policy: LedgerPolicy | undefined,
): (kind: PieceKind, id: string) => boolean {
  const p = { ...DEFAULTS, ...policy };
  const demotions = new Map<string, number>();
  return (kind, id) => {
    const row = ledger.row(kind, id);
    if (!row) return true; // unknown to the ledger → always include
    if (row.offered < p.minOffers) return true; // not enough data to judge
    if (row.earnRate >= p.earnRateFloor) return true; // earning its tokens
    // Demoted — but parole every Nth decision keeps the data flowing.
    const key = `${kind}:${id}`;
    const count = (demotions.get(key) ?? 0) + 1;
    demotions.set(key, count);
    return p.refreshEvery !== Infinity && count % p.refreshEvery === 0;
  };
}

/**
 * TOOL GATE — plug into the existing provider combinator:
 *
 * ```ts
 * import { gatedTools, staticTools } from 'agentfootprint/providers';
 * builder.toolProvider(gatedTools(staticTools(tools), ledgerToolGate(ledger)));
 * ```
 *
 * Unused tool schemas are usually the biggest silent token cost — this is
 * the gate to start with.
 */
export function ledgerToolGate(ledger: ContextLedger, policy?: LedgerPolicy): ToolGatePredicate {
  const verdict = makeVerdict(ledger, policy);
  return (toolName) => verdict('tool', toolName);
}

/**
 * SKILL GATE — an `EntryScorer` for `skillGraph().entryBy(...)` that wraps
 * another scorer (keyword, embedding, …) and demotes candidates the ledger
 * says never earn. Demotion multiplies the inner score toward the floor —
 * ranking pressure, not exclusion — and parole restores full weight
 * periodically, so a demoted skill can still win when nothing else fits.
 */
export function ledgerEntryScorer(
  ledger: ContextLedger,
  inner: EntryScorer,
  policy?: LedgerPolicy,
): EntryScorer {
  const verdict = makeVerdict(ledger, policy);
  const DEMOTION_WEIGHT = 0.25;
  return {
    name: `ledger(${inner.name})`,
    async score(input: EntryScorerInput, signal?: AbortSignal): Promise<EntryScoring> {
      const base = await inner.score(input, signal);
      // Re-rank through rankEntries so `chosen`, `score` AND `relevance` are
      // recomputed TOGETHER from the demoted scores — preserving the
      // entryScorer contract (argmax-score == argmax-relevance; the "Why
      // this skill?" panel and the pick can never disagree).
      const candidates = base.ranked.map((r) => ({
        id: r.id,
        description: input.candidates.find((c) => c.id === r.id)?.description ?? '',
      }));
      const demotedScores = base.ranked.map((r) =>
        verdict('skill', r.id) ? r.score : r.score * DEMOTION_WEIGHT,
      );
      return rankEntries(`ledger(${base.scorer})`, candidates, demotedScores);
    },
  };
}

/**
 * INJECTION GATE — wrap ONE injection so the ledger's verdict joins its
 * trigger. `always` becomes a ledger-backed rule; an existing `rule` is
 * AND-ed with the verdict. `on-tool-return` / `llm-activated` are returned
 * UNCHANGED (they are already demand-driven — the ledger has nothing to
 * add). `always` pieces are exempt unless you explicitly wrap them — the
 * safety-first default from the design.
 */
export function ledgerGated(
  injection: Injection,
  ledger: ContextLedger,
  policy?: LedgerPolicy,
): Injection {
  const verdict = makeVerdict(ledger, policy);
  const kind: PieceKind = injection.flavor === 'skill' ? 'skill' : 'injection';
  const trigger = injection.trigger;
  if (trigger.kind === 'always') {
    return {
      ...injection,
      trigger: { kind: 'rule', activeWhen: () => verdict(kind, injection.id) },
    };
  }
  if (trigger.kind === 'rule') {
    const original = trigger.activeWhen;
    return {
      ...injection,
      trigger: { kind: 'rule', activeWhen: (ctx) => original(ctx) && verdict(kind, injection.id) },
    };
  }
  return injection; // demand-driven triggers pass through untouched
}
