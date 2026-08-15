/**
 * runManifest — the run-configuration manifest, composed.
 *
 * Pattern: Pure builder over already-resolved configuration.
 * Role:    Turn what an Agent HOLDS into what `agentfootprint.agent.run_configured`
 *          SAYS. Kept out of Agent.ts so the rule that governs it — names only,
 *          absence never guessed — is testable without building an agent, and
 *          so the one place that decides what may leave the process is one
 *          small file rather than a paragraph inside a 3,000-line class.
 * Emits:   N/A — the Agent dispatches what this returns.
 *
 * ## The rule this file exists to keep
 *
 * The manifest carries NAMES AND IDS ONLY. Not endpoints, not directories, not
 * connection strings, not keys, not tenants, not principals — and not a config
 * VALUE that could be any of those. It rides into every recording, every vendor
 * sink and every shared trace, which is exactly where a secret must not go.
 *
 * That rule is why this file takes an already-narrowed input rather than the
 * Agent: nothing here can reach a store's options bag even by accident, because
 * a store is never passed in. Where the only handle on a component is a value
 * (a directory, a URL, a table name), the component is reported as PRESENT and
 * left unnamed — {@link RunManifestSources.artifacts} is the shape of that
 * answer. A field the configuration did not declare is ABSENT: "the strategy
 * did not say" and "the default" are different facts, and only the first one is
 * true here.
 */

import type {
  AgentRunConfiguredPayload,
  RunConfiguredMemoryPayload,
} from '../../events/payloads.js';
import type { MemoryDefinition } from '../../memory/define.types.js';

/**
 * What the Agent hands over — already resolved, already narrowed to names.
 *
 * Every member is something the Agent knows at `createExecutor()` time, before
 * the first stage runs. Anything it does not know then is deliberately not on
 * this type: a manifest that had to run a stage to fill itself in would be
 * describing a run already in progress.
 */
export interface RunManifestSources {
  readonly agentId: string;
  /** `LLMProvider.name` of the effective (decorators included) provider. */
  readonly providerName: string;
  /** The agent's resolved default model — the one this run starts with. */
  readonly model: string;
  /** A `.configure()` resolver is mounted: it may replace the model per run,
   *  and it runs in seed, AFTER this event. */
  readonly hasRunConfig: boolean;
  /** Per-skill brains are mounted: they may replace provider/model per call. */
  readonly hasSkillBrains: boolean;
  readonly reactMode: 'classic' | 'dynamic' | 'dynamic-grouped';
  readonly memories: readonly MemoryDefinition[];
  /** `WindowStrategy.name` from `.window()` / `.compaction()`. */
  readonly windowStrategyName?: string;
  /** A skill graph is mounted — the OBJECT's presence in the payload means
   *  exactly this, and each of its fields is separately optional. */
  readonly skillGraph?: {
    readonly routing?: 'assist' | 'guard' | 'rails';
    readonly continuity?: 'turn' | 'conversation';
    /** `IntentScorer.name`. Undefined for a graph with no `.classify()`. */
    readonly scorerName?: string;
  };
  readonly evidenceGatePosture?: 'assist' | 'guard' | 'rails';
  /**
   * The artifacts wiring, as booleans.
   *
   * `ArtifactStore` declares no id, so WHICH store is unnameable — and the
   * things that would identify one (a directory, a bucket, a table) are the
   * values this manifest exists not to carry. `configured` is the honest
   * remainder: a store IS in play. Omit the whole member when none is.
   */
  readonly artifacts?: {
    readonly configured: true;
    readonly placement: boolean;
    readonly recordings: boolean;
  };
}

/**
 * Compose the manifest. Pure: same input, same payload, no clock, no ids
 * minted here (the runId the arms are grouped by is already on `meta`).
 */
export function buildRunManifest(sources: RunManifestSources): AgentRunConfiguredPayload {
  // Who may replace the model mid-run. Built as a list of NAMES rather than a
  // boolean so a reader knows which mechanism to go look at, and left absent
  // when nobody can — that absence is the strong statement: `model` is then
  // what every call of this run used, and an arm can be grouped on it alone.
  const modelOverrides: ('configure' | 'skill-brains')[] = [];
  if (sources.hasRunConfig) modelOverrides.push('configure');
  if (sources.hasSkillBrains) modelOverrides.push('skill-brains');

  const artifacts = sources.artifacts;

  return {
    agentId: sources.agentId,
    llm: {
      provider: sources.providerName,
      model: sources.model,
      ...(modelOverrides.length > 0 && { modelOverrides }),
    },
    reactMode: sources.reactMode,
    // `[]` rather than an omitted field: "no memory is mounted" is an arm, and
    // a consumer grouping on retrieval strategy must be able to tell it from a
    // manifest that forgot to look.
    memories: sources.memories.map(describeMemory),
    ...(sources.windowStrategyName !== undefined && { window: sources.windowStrategyName }),
    ...(sources.skillGraph !== undefined && {
      skillGraph: {
        ...(sources.skillGraph.routing !== undefined && { routing: sources.skillGraph.routing }),
        ...(sources.skillGraph.continuity !== undefined && {
          continuity: sources.skillGraph.continuity,
        }),
        ...(sources.skillGraph.scorerName !== undefined && {
          scorer: sources.skillGraph.scorerName,
        }),
      },
    }),
    ...(sources.evidenceGatePosture !== undefined && {
      evidenceGate: sources.evidenceGatePosture,
    }),
    // Only the TRUE dials are written. `placement: false` would be noise on
    // every artifact-configured agent; the object's presence already says a
    // store is wired.
    ...(artifacts !== undefined && {
      artifacts: {
        ...(artifacts.placement && { placement: true as const }),
        ...(artifacts.recordings && { recordings: true as const }),
      },
    }),
  };
}

/**
 * One memory row — only the names the definition DECLARED.
 *
 * `store` is never described: `MemoryStore` has no id and no kind, and a class
 * name is a label no bundler promises to keep. An arm grouped on an invented
 * label is an arm that silently regroups itself on the next build.
 */
function describeMemory(def: MemoryDefinition): RunConfiguredMemoryPayload {
  return {
    id: def.id,
    type: def.type,
    ...(def.strategy !== undefined && { strategy: def.strategy }),
    ...(def.retrieval !== undefined && { retrieval: def.retrieval }),
    ...(def.embedderId !== undefined && { embedderId: def.embedderId }),
    ...(def.flavor !== undefined && { flavor: def.flavor }),
  };
}
