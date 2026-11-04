import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type {
  CoverageReading,
  CoverageFacts,
  DeclaredCoverage,
  ToolAbsence,
} from '../../../../../../semantics/coverage/index.js';
import type { ToolResultStatus } from '../../../../../../semantics/toolEffects.js';
import type { LLMMessage } from '../../../../../../provider-contract/types.js';

/** Explicit callback contract for existing coverage operations. */
export interface ToolCoverageOperations {
  readonly declareCoverage: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    value: unknown,
    composed?: CoverageReading,
  ) => ToolResultStatus | undefined;
  readonly declareComposed: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    facts: CoverageFacts,
  ) => DeclaredCoverage;
  readonly declareRaisedAbsence: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    args: Readonly<Record<string, unknown>>,
    absence: ToolAbsence,
    history: readonly LLMMessage[],
  ) => string | undefined;
}
