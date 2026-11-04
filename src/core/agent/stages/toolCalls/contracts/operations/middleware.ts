import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { Tool } from '../../../../../../tools/tools.js';
import type { ToolArgs } from '../../../../../../tools/runChain.js';
import type { LLMMessage } from '../../../../../../provider-contract/types.js';

/** Explicit callback contract for existing middleware operations. */
export interface ToolMiddlewareOperations {
  readonly afterMoment: (
    scope: TypedScope<AgentState>,
    call: {
      readonly tool?: Tool;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      readonly args: ToolArgs;
      readonly result: unknown;
      readonly error?: boolean;
      readonly negativeResultId?: string;
      readonly history: readonly LLMMessage[];
      readonly identity?: { tenant?: string; principal?: string; conversationId: string };
      readonly signal?: AbortSignal;
    },
  ) => Promise<unknown>;
}
