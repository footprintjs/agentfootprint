import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type {
  ReadToolResultEnvelope,
  ToolResultStatus,
} from '../../../../../semantics/toolEffects.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { CodeRunFacts } from '../../../../codeRunnerTool.js';
import type { NegativeDispatch } from '../../../negativeClaims/capture.js';
import type { NativeResultFinalizer } from '../../../resultRowsets/finalization.js';
import type { InnerCallHalt } from '../../../innerCallOuter.js';

/** Invocation-local phase cells; never checkpoint state or a run registry. */

export interface CallResultCell {
  result: unknown;
  error: boolean | undefined;
  toolEnvelope: ReadToolResultEnvelope | undefined;
  toolStatus: ToolResultStatus | undefined;
  /** The status word of a result that is an envelope but for an unknown
   *  status (`semantics/toolEffects.ts` · `unknownStatusOf`), cleaned —
   *  read only by the procedure step, which tells it. */
  unknownStatus: string | undefined;
}

export interface CallArguments {
  callArgs: ToolArgs;
  chainedArgs: ToolArgs;
}

export interface CallExecution {
  resultFinalizer?: NativeResultFinalizer;
  denied: boolean;
  executed: boolean;
  toolResultExecution?: LLMMessage['toolResultExecution'];
  submittedProgram: unknown;
  executeThrew: boolean;
  ranCode: CodeRunFacts | undefined;
  withheldOverCeiling: boolean;
  negativeDispatch: NegativeDispatch | undefined;
  ceilingRefused: boolean;
  haltContext:
    | {
        reason: string;
        tellLLM: string;
        checkerId?: string;
        /** Present when an INNER call drew the halt (`innerCallOuter.ts`): the call it names. */
        call?: InnerCallHalt['call'];
      }
    | undefined;
}

export interface CallArgumentGate {
  argsRejected: boolean;
}

export interface CallConsentGate {
  checkInRefused: boolean;
}

export interface CallSkillRoute {
  skillRejected: boolean;
  skillHop: boolean;
}

export interface CallDelivery {
  resultStr: string;
  modelResultCapped: boolean;
  toolResultDisposition?: LLMMessage['toolResultDisposition'];
}
