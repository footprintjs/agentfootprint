/**
 * selfExplainHost — the trace toolpack's binding of the agent builder's
 * `.selfExplain()` port, and the module the root door takes `Agent` and
 * `AgentBuilder` from.
 *
 * Pattern: Plugin registration (the `devWarnHost.ts` precedent).
 * Role:    trace-toolpack (layer L10, above the agent). The agent builder
 *          names only `core/agent/selfExplainPort.ts`; this file hands it the
 *          three pieces `selfExplain.ts` builds — the binding, the skill and
 *          the provider — at load, before any builder can reach `build()`.
 * Emits:   nothing.
 *
 * WHY THE CLASSES ARE RE-EXPORTED HERE. The root barrel and every other door
 * are flagged side-effect-free (package.json `sideEffects`), and a bundler is
 * then free to skip a barrel and link `import { Agent }` straight to the module
 * that declares it. A registration placed in the barrel would be skipped with
 * it: webpack and rolldown both drop it (measured on a minimal package, both
 * bundlers, while this file was written). So the root door re-exports `Agent` and
 * `AgentBuilder` FROM this module, which IS flagged as having side effects —
 * whoever imports the agent through a door runs this file first, and a bundle
 * that never names the agent does not carry it. `traceDebugAgent.ts` builds
 * its agent from the same import, so `agentfootprint/observe`, the other door
 * whose graph reaches the builder, registers too.
 */

import { registerSelfExplain, type SelfExplainExtension } from '../core/agent/selfExplainPort.js';
import {
  buildSelfExplainSkill,
  buildSelfExplainToolProvider,
  SelfExplainBinding,
} from './selfExplain.js';

/** The toolpack's half of the port, exactly what the builder called before the port existed. */
export const selfExplainExtension: SelfExplainExtension = {
  binding: (options) => new SelfExplainBinding(options.include, options.maxEvents),
  skill: buildSelfExplainSkill,
  toolProvider: buildSelfExplainToolProvider,
};

registerSelfExplain(selfExplainExtension);

export { Agent, AgentBuilder } from '../core/Agent.js';
