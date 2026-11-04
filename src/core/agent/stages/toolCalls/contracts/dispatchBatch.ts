import type { buildDispatchContext } from '../batch/dispatchContext.js';
import type { buildFindingsAdmission } from '../batch/findingsAdmission.js';
import type { InputsDispatch } from './inputsDispatch.js';
import type { DispatchCall } from './batchCall.js';

type BatchContext = ReturnType<ReturnType<typeof buildDispatchContext>['prepareDispatchContext']>;
type BatchAdmission = ReturnType<ReturnType<typeof buildFindingsAdmission>['admitFindingsBatch']>;

/** Runtime references for ONE batch; never stored in scope, a checkpoint, or a run registry. */
export type DispatchBatchFrame = Readonly<
  BatchContext & {
    toolCalls: readonly DispatchCall[];
    iteration: number;
    findingsRefusals: BatchAdmission['findingsRefusals'];
    inputs: InputsDispatch | undefined;
    resolutions: ReturnType<InputsDispatch['resolutionsFor']> | undefined;
    askedLayer: InputsDispatch | undefined;
    oneQuestionAsked: boolean;
  }
>;
