import type {
  ReadToolResultEnvelope,
  ToolResultStatus,
} from '../../../../../semantics/toolEffects.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { CodeRunFacts } from '../../../../codeRunnerTool.js';
import type { NegativeDispatch } from '../../../negativeClaims/capture.js';
import type { InnerCallHalt } from '../../../innerCallOuter.js';

/** Invocation-local phase cells; never checkpoint state or a run registry. */

export interface CallResultCell {
  result: unknown;
  error: boolean | undefined;
  toolEnvelope: ReadToolResultEnvelope | undefined;
  toolStatus: ToolResultStatus | undefined;
}

export interface CallArguments {
  callArgs: ToolArgs;
  chainedArgs: ToolArgs;
}

export interface CallExecution {
  denied: boolean;
  executed: boolean;
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
}
