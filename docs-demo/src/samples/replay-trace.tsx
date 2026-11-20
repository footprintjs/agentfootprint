// #region code
import { Replay, type ReplayProps } from 'agentfootprint-lens';

export function ReplayTraceSample({ trace }: { trace: ReplayProps['trace'] }) {
  return <Replay trace={trace} />;
}
// #endregion code
