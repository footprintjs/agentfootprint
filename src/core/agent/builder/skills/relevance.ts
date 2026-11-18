import { isDevMode } from 'footprintjs';
import { READS_ENTRY_SCORES_METADATA_KEY } from '../../../../injection-engine/factories/defineRelevanceHint.js';
import type { Injection } from '../../../../injection-engine/types.js';

/**
 * Dev-warn a `defineRelevanceHint()` mounted where no scorer can feed it (8.7.0).
 *
 * The hint's trigger reads `ctx.entryScores`, and only the PickEntry stage writes it
 * — which runs only when the graph was built with `.entryBy()` / `.entryByRelevance()`
 * / `start: { entries, scoredBy | byRelevance }`. Without one, the injection mounts,
 * evaluates false on every iteration for the life of the agent, and reports nothing:
 * a feature that is configured and inert looks exactly like a feature that is working
 * and simply has not been needed yet.
 *
 * Keyed on the `readsEntryScores` metadata marker, not on the id — the id is the
 * caller's to rename.
 */
function warnInertRelevanceHint(injections: readonly Injection[], hasScorer: boolean): void {
  if (hasScorer || !isDevMode()) return;
  for (const inj of injections) {
    const meta = inj.metadata as Record<string, unknown> | undefined;
    if (meta?.[READS_ENTRY_SCORES_METADATA_KEY] !== true) continue;
    // eslint-disable-next-line no-console
    console.warn(
      `agentfootprint Agent: injection '${inj.id}' reads ctx.entryScores, which only an ENTRY ` +
        `SCORER produces — and this agent's skill graph has none, so the injection can never ` +
        `activate. Build the graph with .entryBy(keywordScorer()) or .entryByRelevance(embedder) ` +
        `(object form: start: { entries, scoredBy }), or drop the injection. Note .entryByRead() ` +
        `does NOT score — there the model picks, so there is no near-tie to report.`,
    );
  }
}

export { warnInertRelevanceHint };
