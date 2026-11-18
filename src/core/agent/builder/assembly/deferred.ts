import { isDevMode } from 'footprintjs';
import type { Injection } from '../../../../injection-engine/types.js';
import {
  SKILL_GRAPH_DEFERRED_CONTRACT_KEY,
  type DeferredBodyContract,
} from '../../../../injection-engine/skillGraph.js';
import { checkSkillContracts, skillToolNames } from '../../../../injection-engine/skillContract.js';
import { formatCheckup } from '../../../../injection-engine/skillGraphCheckup.js';
import type { ToolRegistryEntry } from '../../../../tools/tools.js';
export interface DeferredPort {
  skillGraphDeferredBodyContract?: {
    readonly mode: 'throw' | 'warn';
    readonly skills: readonly Injection[];
  };
  readonly registry: ToolRegistryEntry[];
}

export function checkDeferredContracts(self: DeferredPort, injections: Injection[]): void {
  // The skill graph's DEFERRED body-contract checks run HERE — the one build point
  // that can see the full tool registry. At graph build (without `knownTools`) a
  // body's `lookup_order(id)` is indistinguishable from a typo, because `.tool()`
  // has not run yet; the graph said nothing it could not prove and left its note.
  // The note is collected from the FINAL injection list (each deferred graph skill
  // carries it in its metadata), so the checks run whichever door the skills came
  // through — `.skillGraph(graph)` or `.skills({ list: () => graph.skills })`.
  // The `.skillGraph()` capture is folded in as a fallback for a structurally-typed
  // graph without per-skill stamps; skills found by both are deduped by id, so one
  // problem is reported once. The known set checked now: the agent's registered
  // tool names ∪ `read_skill` (auto-attached whenever a skill exists, so a hand-off
  // hint naming it is not a typo) ∪ every NON-deferred skill's tool names (they
  // exist on this agent; calling them nonexistent would be false) — plus, inside
  // checkSkillContracts, the checked skills' own tools. Runs at most once per built
  // agent, and never when the graph already ran its checks with an explicit
  // `knownTools`: one problem, one report. Baseline `ToolProvider` tools are
  // per-iteration and cannot be enumerated at build time — bodies naming only
  // provider-delivered tools should pass the names via the graph's `knownTools`.
  const deferredByMode = new Map<'throw' | 'warn', Injection[]>();
  const deferredIds = new Set<string>();
  const collectDeferred = (skill: Injection, mode: 'throw' | 'warn'): void => {
    if (deferredIds.has(skill.id)) return; // metadata + graph note = ONE check
    deferredIds.add(skill.id);
    const group = deferredByMode.get(mode);
    if (group) group.push(skill);
    else deferredByMode.set(mode, [skill]);
  };
  for (const i of injections) {
    const note = (i.metadata as { [SKILL_GRAPH_DEFERRED_CONTRACT_KEY]?: DeferredBodyContract })?.[
      SKILL_GRAPH_DEFERRED_CONTRACT_KEY
    ];
    if (note?.mode === 'throw' || note?.mode === 'warn') collectDeferred(i, note.mode);
  }
  if (self.skillGraphDeferredBodyContract) {
    const { mode, skills: graphSkills } = self.skillGraphDeferredBodyContract;
    for (const s of graphSkills) collectDeferred(s, mode);
  }
  if (deferredByMode.size > 0) {
    // Tools on skills OUTSIDE the deferred set exist on this agent — baseline,
    // not typos. Tools on deferred skills are added per group by
    // checkSkillContracts itself (own vs known matters for body-foreign-tool).
    const baseKnownTools = [
      ...self.registry.map((entry) => entry.name),
      'read_skill',
      ...injections
        .filter((i) => i.flavor === 'skill' && !deferredIds.has(i.id))
        .flatMap((s) => skillToolNames(s)),
    ];
    // One group per deferring graph's `check` mode — two graphs fed via
    // `.skills()` may disagree, and each is judged by its OWN declared severity.
    for (const [mode, group] of deferredByMode) {
      const groupIds = new Set(group.map((s) => s.id));
      const knownTools = [
        ...baseKnownTools,
        ...[...deferredByMode.values()]
          .flat()
          .filter((s) => !groupIds.has(s.id))
          .flatMap((s) => skillToolNames(s)),
      ];
      const problems = checkSkillContracts(group, { knownTools });
      if (problems.length === 0) continue;
      const report = { ok: !problems.some((p) => p.kind === 'error'), problems };
      // Severity per the GRAPH's own check mode. Both contract checks are
      // warnings today, so `'throw'` and `'warn'` both surface as a dev-mode
      // warning — but an error-kind problem, should one ever exist, honors
      // `'throw'` here exactly as it would have at graph build.
      if (mode === 'throw' && !report.ok) {
        throw new Error(
          `Agent.build(): skill-body ↔ tool-contract check-up failed ` +
            `(deferred from graph build; checked against this agent's full tool ` +
            `registry):\n${formatCheckup(report)}`,
        );
      }
      if (isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          `agentfootprint Agent: skill-graph body-contract check-up (deferred from ` +
            `graph build; checked here against the agent's full tool registry — pass ` +
            `knownTools to skillGraph to run it at graph build instead):\n` +
            formatCheckup(report),
        );
      }
    }
  }
}
