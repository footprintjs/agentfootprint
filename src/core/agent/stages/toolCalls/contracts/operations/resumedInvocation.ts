import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { Resolution, ResumedCallFacts } from '../callFacts.js';
import type { ConsentGateKind } from '../../../../../pause.js';
import type { ReadToolResultEnvelope } from '../../../../../../semantics/toolEffects.js';

/** The existing resumed invocation contract; no new execution path. */
export interface ResumedInvocation {
  readonly resolveCredentialAndExecute: (
    scope: TypedScope<AgentState>,
    resolved: Resolution,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    toolCallId: string,
    iteration: number,
    env: { readonly signal?: AbortSignal },
    heldTo?: ConsentGateKind,
    seen?: ResumedCallFacts,
  ) => Promise<{
    result: unknown;
    error?: boolean;
    executed?: boolean;
    negativeResultId?: string;
    /** The recognized effects envelope, when the tool returned one (9.19.0)
     *  — `result` above is already its unwrapped `content`. When the ceiling
     *  fired this carries the refusal as `content` and status `'invalid'`
     *  (synthesized empty-effects for a non-envelope result), so every resume
     *  path routes the status without knowing about ceilings. */
    envelope?: ReadToolResultEnvelope;
    /** The tool's own `resultCeiling` refused the result (9.20.0): `result`
     *  is the teaching refusal, the true size is on the record. The call ran
     *  — but it must not complete a procedure step (the model was told to
     *  call again). */
    ceilingRefused?: true;
    /** An approved call's arguments no longer matched its request at the
     *  last moment before `execute` (`heldTo`): the call did not run. */
    callChanged?: true;
    /** The result was an envelope in every way but an unknown status word —
     *  that word, cleaned (`semantics/toolEffects.ts` · `unknownStatusOf`);
     *  read only by the procedure step. */
    unknownStatus?: string;
  }>;
}
