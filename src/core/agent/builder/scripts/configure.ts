import { resolveScriptTravel } from '../../scripts/attachment.js';
import type { ResolvedScriptTravel, ScriptTravelOptions } from '../../scripts/types.js';

export interface ScriptTravelPort {
  scriptTravelValue?: ResolvedScriptTravel;
}

export function configureScriptTravel<TReceiver extends ScriptTravelPort>(
  self: TReceiver,
  opts: ScriptTravelOptions | undefined,
  original: object,
): object {
  if (self.scriptTravelValue !== undefined) {
    throw new Error(
      'AgentBuilder.scriptTravelsWithTheAnswer: already set. One agent attaches its scripts ' +
        'one way — pass `which` and `maxBytes` in the one call.',
    );
  }
  self.scriptTravelValue = resolveScriptTravel(opts);
  return original;
}
