/**
 * selfExplainPort — the seam `.selfExplain()` plugs into.
 *
 * Pattern: Port + a one-slot registry (the `devWarn.ts` / `devWarnHost.ts`
 *          shape of the injection engine).
 * Role:    core/ layer. `AgentBuilder.selfExplain` records the options and
 *          `AgentBuilder.build` asks this port for the three pieces the trace
 *          toolpack supplies: the binding that keeps each finished turn's
 *          evidence, the methodology skill, and the skill-scoped provider of
 *          the trace tools. The toolpack reads a FINISHED run, so it sits above
 *          the agent in the layer table and the agent may not import it; the
 *          agent names only this port, and the toolpack registers itself here
 *          (`lib/trace-toolpack/selfExplainHost.ts` · `selfExplainExtension`).
 * Emits:   nothing.
 *
 * WHO REGISTERS. `selfExplainHost.ts` registers at load, and every published
 * door that hands out the agent takes `Agent` and `AgentBuilder` FROM that
 * host, so the registration travels with the class: a consumer on a door never
 * meets the refusal below, and a bundler that skips a barrel cannot drop it
 * (the host is listed in package.json `sideEffects`). Only a deep import of
 * the builder's own module, past every door, reaches `build()` unregistered.
 */

import type { Injection } from '../../lib/injection-engine/types.js';
import type {
  SelfExplainBinding,
  SelfExplainOptions,
} from '../../lib/trace-toolpack/selfExplain.js';
import type { ToolProvider } from '../../tools/toolProvider.js';

/** What the trace toolpack hands the agent builder for `.selfExplain()`. */
export interface SelfExplainExtension {
  /** A fresh binding per `build()`, so two built agents never share evidence. */
  binding(options: SelfExplainOptions): SelfExplainBinding;
  /** The skill `.selfExplain()` mounts: the methodology body only. */
  skill(options: SelfExplainOptions): Injection;
  /** The trace tools behind the skill's activation, composed with the consumer's own provider. */
  toolProvider(
    binding: SelfExplainBinding,
    options: SelfExplainOptions,
    existing?: ToolProvider,
  ): ToolProvider;
}

/** The refusal `build()` raises when `.selfExplain()` was asked for and nothing registered. */
export const SELF_EXPLAIN_UNREGISTERED =
  'AgentBuilder.selfExplain: the trace toolpack is not registered — import Agent from ' +
  "'agentfootprint' (a published door), not from an internal module path that skips it.";

let registered: SelfExplainExtension | undefined;

/**
 * Plug the trace toolpack into the builder. Called once, at load, by
 * `selfExplainHost.ts`; registering the same extension again is a no-op, and a
 * DIFFERENT one is refused rather than silently replacing the first.
 */
export function registerSelfExplain(extension: SelfExplainExtension): void {
  if (registered !== undefined && registered !== extension) {
    throw new Error(
      'registerSelfExplain: a different self-explain extension is already registered.',
    );
  }
  registered = extension;
}

/** The registered extension, or the refusal when there is none. Read by `AgentBuilder.build`. */
export function requireSelfExplain(): SelfExplainExtension {
  if (registered === undefined) throw new Error(SELF_EXPLAIN_UNREGISTERED);
  return registered;
}
