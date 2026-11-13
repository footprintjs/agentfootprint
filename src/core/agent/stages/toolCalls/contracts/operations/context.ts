import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { LLMMessage } from '../../../../../../provider-contract/types.js';
import type { ToolExecutionContext } from '../../../../../../tools/tools.js';
import type { ArtifactScope } from '../../../../../../artifacts/types.js';
import type { OuterCallBinding } from '../../../../innerCallOuter.js';

/** Explicit callback contract for existing context operations. */
export interface ToolContextOperations {
  readonly toolArtifacts: (
    scope: TypedScope<AgentState>,
    toolName: string,
    toolCallId: string,
  ) => Pick<ToolExecutionContext, 'artifacts' | 'hasArtifacts'>;
  readonly toolDispatchCtx: (
    scope: TypedScope<AgentState>,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      /** The history the outer call's own gates were handed — its inner calls' gates get it too. */
      readonly history: () => LLMMessage[];
      /** The outer call's hold on its inner calls: ended when `execute` settles, and a halt. */
      readonly binding: OuterCallBinding;
    },
    signal?: AbortSignal,
  ) => Pick<ToolExecutionContext, 'tools'>;
  readonly runScopeOf: (scope: TypedScope<AgentState>) => ArtifactScope;
}
