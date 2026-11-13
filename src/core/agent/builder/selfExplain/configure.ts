import type { SelfExplainExtension } from '../../selfExplainPort.js';
import type { AgentOptions } from '../../types.js';

type SelfExplainConfiguration = Parameters<SelfExplainExtension['binding']>[0];

export interface SelfExplainPort {
  selfExplainConfig?: SelfExplainConfiguration;
  readonly opts: Pick<AgentOptions, 'reactMode'>;
}

export function configureSelfExplain(
  self: SelfExplainPort,
  opts: SelfExplainConfiguration,
  original: object,
): object {
  if (self.selfExplainConfig !== undefined) {
    throw new Error('AgentBuilder.selfExplain: already enabled.');
  }
  if (self.opts.reactMode === 'classic') {
    // Classic ReAct caches the tools slot on turn 1 — a mid-turn skill
    // activation could never surface the trace tools. Fail loud at
    // build-time rather than silently never answering why-questions.
    throw new Error(
      'AgentBuilder.selfExplain: requires per-iteration slot recomposition — ' +
        "reactMode 'classic' caches the tools slot, so the activated trace tools " +
        "would never reach the model. Use the default 'dynamic' mode (or " +
        "'dynamic-grouped'), or use traceDebugAgent() as a separate session instead.",
    );
  }
  self.selfExplainConfig = opts;
  return original;
}
