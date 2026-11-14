import type { MemoryIdentity } from '../../../memory/identity/types.js';

/**
 * What `.configure(fn)` may change for one run. Both fields are
 * optional; returning `{}` (or nothing) means "use the built defaults",
 * which is exactly what an agent without `.configure()` does.
 *
 * Deliberately NOT the tools axis — `.toolProvider()` already owns that,
 * and it is consulted every iteration rather than once per run.
 */
export interface RunConfig {
  /** Model id for every LLM call in this run. */
  readonly model?: string;
  /** Replaces the base system prompt set by `.system(...)` for this run. */
  readonly instructions?: string;
}

/** What a `.configure(fn)` resolver is given. */
export interface RunConfigContext {
  /** The message this run was started with. */
  readonly message: string;
  /** The memory identity passed to `run({ identity })`, when there was one. */
  readonly identity?: MemoryIdentity;
  /** This run's id — the same one that stamps every typed event's `meta.runId`. */
  readonly runId: string;
  /** What the agent was BUILT with, so a resolver can decide relative to it. */
  readonly defaults: {
    readonly model: string;
    readonly instructions: string;
  };
}

/**
 * Per-run configuration resolver — see `AgentBuilder.configure`. Called
 * exactly once per run, synchronously, at the start of the run.
 */
export type RunConfigFn = (ctx: RunConfigContext) => RunConfig | undefined;
