import type { TypedScope } from 'footprintjs';
import type { InnerCallRan } from '../../provider-contract/innerCalls.js';
import {
  INNER_CALL_POLICY_KEY,
  InnerCallPolicyUnavailableError,
  type InnerCallPolicyCarrier,
} from '../../redaction/innerCallPolicyCarrier.js';
import { markPrivateFields } from '../../redaction/runRedaction.js';
import type { ToolArgs } from '../../tools/runChain.js';
import { carriesArgumentView, shownArgsOf } from '../toolShownArgs.js';
import { takeArguments } from './innerCallArguments.js';
import type { AgentState } from './types.js';

interface InnerCallPolicyState {
  readonly innerCallPolicyArgs?: InnerCallPolicyCarrier;
}

export type InnerCallPolicyScope = TypedScope<AgentState & InnerCallPolicyState>;

/** Run a tool's display projection on a copy. An unusable view hides every key. */
export function shownInnerArgs(tool: unknown, args: ToolArgs): ToolArgs {
  if (!carriesArgumentView(tool)) return args;
  const shown = takeArguments(shownArgsOf(tool, structuredClone(args)));
  if (shown.kind === 'copied') return shown.args;
  return Object.fromEntries(Object.keys(args).map((key) => [key, 'REDACTED']));
}

/** Keep protected policy inputs in native private state, never on the displayed call. */
export function prepareInnerCallRecord(
  scope: InnerCallPolicyScope,
  tool: unknown,
  actual: ToolArgs,
): Pick<InnerCallRan, 'args' | 'policyArgsRef'> {
  const args = shownInnerArgs(tool, actual);
  if (args === actual || JSON.stringify(args) === JSON.stringify(actual))
    return { args, policyArgsRef: null };

  const policyArgsRef = globalThis.crypto.randomUUID();
  const previous = scope.$getValue(INNER_CALL_POLICY_KEY) as
    | InnerCallPolicyState['innerCallPolicyArgs']
    | undefined;
  if (previous !== undefined && Object.hasOwn(previous, policyArgsRef)) {
    throw new Error('An inner call policy reference was already assigned.');
  }
  restoreInnerCallPolicyArgs(scope, { ...previous, [policyArgsRef]: actual });
  return { args, policyArgsRef };
}

export function restoreInnerCallPolicyArgs(
  scope: InnerCallPolicyScope,
  carrier: InnerCallPolicyCarrier | undefined,
): void {
  if (carrier === undefined) return;
  markPrivateFields(scope, [{ root: INNER_CALL_POLICY_KEY, path: '' }]);
  scope.$setValue(INNER_CALL_POLICY_KEY, carrier);
}

/** Read only for a tool-call permission request. Missing private state fails admission closed. */
export function policyArgsOf(scope: InnerCallPolicyScope, call: InnerCallRan): ToolArgs {
  if (call.policyArgsRef === null) return structuredClone(call.args);
  const stored = scope.$getValue(INNER_CALL_POLICY_KEY);
  const raw =
    typeof call.policyArgsRef === 'string' && stored !== null && typeof stored === 'object'
      ? Object.getOwnPropertyDescriptor(stored, call.policyArgsRef)?.value
      : undefined;
  const taken = raw === undefined ? undefined : takeArguments(raw);
  if (taken?.kind !== 'copied') {
    throw new InnerCallPolicyUnavailableError();
  }
  return taken.args;
}
