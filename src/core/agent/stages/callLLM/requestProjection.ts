import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { ThinkingBlock } from '../../../../thinking/types.js';
import {
  openReplayProjection,
  privateTurnEnd,
  readRequestReplay,
  type RequestReplayValue,
} from '../../requestTurn/state.js';
import type { AgentState } from '../../types.js';

/** Decide which native prefix is still live as the stage assembles this call. */
export function projectCallHistory(
  scope: TypedScope<AgentState>,
  history: readonly LLMMessage[],
  rendered: readonly LLMMessage[],
  needsPrivateClosure: boolean,
) {
  const stored =
    'requestReplay' in scope
      ? (scope.$getValue('requestReplay') as RequestReplayValue | undefined)
      : undefined;
  const replayState = stored === undefined ? undefined : readRequestReplay(stored);
  const prefix = openReplayProjection(replayState, history, rendered);
  const closure =
    needsPrivateClosure && prefix !== undefined && replayState?.closing !== undefined
      ? privateTurnEnd(
          history,
          replayState.closing,
          scope.$getArgs<{ priorReplayThinking?: readonly ThinkingBlock[] }>()
            ?.priorReplayThinking ??
            (scope.$getValue('thinkingBlocks') as AgentState['thinkingBlocks']),
        )
      : undefined;
  const continuing = closure === undefined ? prefix : undefined;
  return {
    replayFrames: replayState?.frames,
    closure,
    continuing,
    messages: continuing?.history ?? rendered,
  };
}
