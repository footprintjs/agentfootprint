import type { CallOccurrenceKey } from '../../../../../../lib/callOccurrence.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { Tool } from '../../../../../../tools/tools.js';
import type { ToolArgs } from '../../../../../../tools/runChain.js';
import type { ExecutedToolResultEnvelope } from '../callCells.js';
import type { EffectAdmission } from '../../decorators/effectAdmission.js';
import type { LLMMessage } from '../../../../../../provider-contract/types.js';

/** Explicit callback contract for existing middleware operations. */
export interface ToolMiddlewareOperations {
  readonly observesResult: boolean;
  readonly afterMoment: (
    scope: TypedScope<AgentState>,
    call: {
      readonly tool?: Tool;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly callOccurrenceKey?: CallOccurrenceKey;
      readonly iteration: number;
      readonly args: ToolArgs;
      readonly result: unknown;
      readonly effectEnvelope?: ExecutedToolResultEnvelope;
      /** The hook received a returned value, including a plain pause answer. */
      readonly returned: boolean;
      readonly error?: boolean;
      readonly negativeResultId?: string;
      /** Invocation-local native withdrawal, never part of middleware input. */
      readonly onSourceWithheld?: () => void;
      readonly history: readonly LLMMessage[];
      readonly identity?: { tenant?: string; principal?: string; conversationId: string };
      readonly signal?: AbortSignal;
    },
  ) => Promise<{
    readonly modelResult: unknown;
    readonly effectAdmission?: EffectAdmission;
    readonly toolResultDisposition?: LLMMessage['toolResultDisposition'];
  }>;
}
