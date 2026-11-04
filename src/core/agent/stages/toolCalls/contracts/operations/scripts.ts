import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { Tool } from '../../../../../../tools/tools.js';
import type { CallSettlement } from '../../../../scripts/label.js';
import type { CodeRunFacts, CodeRunSlot } from '../../../../../codeRunnerTool.js';
import type { ResumedCallFacts } from '../callFacts.js';

/** Explicit callback contract for existing scripts operations. */
export interface ToolScriptsOperations {
  readonly fileScript: (
    scope: TypedScope<AgentState>,
    call: {
      readonly tool: Tool | undefined;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      /** The declared argument's value as the call arrived (`programOfCall`). */
      readonly proposed: unknown;
      /** Its value handed to `execute` — or as it stood at a pause or a refusal. */
      readonly submitted?: unknown;
      readonly settlement: CallSettlement;
      readonly facts?: CodeRunFacts;
      readonly withheld?: boolean;
      readonly paused?: boolean;
      /** The dispatch a settling paused call already has (`pausedScriptDispatch`). */
      readonly dispatch?: number;
    },
  ) => number | undefined;
  readonly programOfCall: (
    tool: Tool | undefined,
    args: Readonly<Record<string, unknown>> | undefined,
  ) => unknown;
  readonly proposedArgsOf: (
    scope: TypedScope<AgentState>,
    toolCallId: string,
  ) => Readonly<Record<string, unknown>> | undefined;
  readonly fileResumedScript: (
    scope: TypedScope<AgentState>,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      readonly carried: Readonly<Record<string, unknown>>;
      readonly entered: boolean;
      readonly seen: ResumedCallFacts;
    },
  ) => void;
  readonly takeCodeRun: (
    scope: TypedScope<AgentState>,
    tool: Tool,
    slot: CodeRunSlot,
    call: { readonly toolName: string; readonly toolCallId: string; readonly takeListed: boolean },
  ) => CodeRunFacts | undefined;
}
