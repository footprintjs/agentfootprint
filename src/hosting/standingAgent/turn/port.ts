import { type Agent } from '../../../core/Agent.js';
import { ReplacedRunnerMethodError } from '../../errors.js';
import { runnerLive } from '../../../core/runnerLive.js';

/**
 * The agent's turn port, or a refusal: it does not call a replaced `run` or
 * `resume`, so a replacement is refused when a lane is built and on every turn.
 */
export function hostedTurnOf(agent: Agent) {
  const turn = runnerLive(agent)?.turn;
  if (turn === undefined) throw new TypeError('Agent turn ownership is unavailable');
  const replaced = turn.replaced();
  if (replaced.length > 0) throw new ReplacedRunnerMethodError(replaced);
  return turn;
}
