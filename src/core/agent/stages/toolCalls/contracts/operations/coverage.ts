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
import type { ToolCallEventIdentity } from '../../../../../../events/types.js';

type CoverageCall = ToolCallEventIdentity & { readonly toolName: string };

/** Explicit callback contract for existing coverage operations. */
export interface ToolCoverageOperations {
  readonly declareCoverage: (
    scope: TypedScope<AgentState>,
    call: CoverageCall,
    value: unknown,
    composed?: CoverageReading,
  ) => ToolResultStatus | undefined;
  readonly declareComposed: (
    scope: TypedScope<AgentState>,
    call: CoverageCall,
    facts: CoverageFacts,
  ) => DeclaredCoverage;
  readonly declareRaisedAbsence: (
    scope: TypedScope<AgentState>,
    call: CoverageCall,
    args: Readonly<Record<string, unknown>>,
    absence: ToolAbsence,
    history: readonly LLMMessage[],
  ) => string | undefined;
}
