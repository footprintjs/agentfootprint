import { matchesPreparedData } from '../../../../../lib/matchesPreparedData.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';

/** Compare the prepared values independently of the views given to policy. */
export function preparedArgumentWitness(args: ToolArgs): (current: ToolArgs) => boolean {
  const expected = structuredClone(args);
  return (current) => matchesPreparedData(expected, current);
}
