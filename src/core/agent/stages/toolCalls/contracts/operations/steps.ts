import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { StepPointer, StepPlan } from '../../../../../../injection-engine/skillSteps.js';
import type { SettledCall } from '../../execution/callOutcome.js';

/** Explicit callback contract for existing steps operations. */
export interface ToolStepsOperations {
  readonly stepStateOf: (
    scope: TypedScope<AgentState>,
  ) => { ptr: StepPointer; plan: StepPlan; step: { tool: string; note: string } } | undefined;
  readonly applySkipStep: (
    scope: TypedScope<AgentState>,
    call: {
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ) => string;
  /** Every door that finishes a call hands over how it settled; the step's
   *  outcome is decided inside (`routing/stepOutcome.ts` · `stepOutcomeOf`). */
  readonly applyStepReturn: (
    scope: TypedScope<AgentState>,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      readonly settled: SettledCall;
    },
  ) => string;
  readonly readSkillStepIntroFor: (pickedId: string) => string;
  readonly noteSkillRefusal: (scope: TypedScope<AgentState>, iteration: number) => void;
}
