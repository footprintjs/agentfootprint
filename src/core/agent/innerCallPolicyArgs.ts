import type { TypedScope } from 'footprintjs';
import type { InnerCallRan } from '../../provider-contract/innerCalls.js';
import { markPrivateFields } from '../../redaction/runRedaction.js';
import type { ToolArgs } from '../../tools/runChain.js';
import { carriesArgumentView, shownArgsOf } from '../toolShownArgs.js';
import { takeArguments } from './innerCallArguments.js';
import type { AgentState } from './types.js';

interface InnerCallPolicyState {
  readonly innerCallPolicyArgs?: Readonly<Record<string, ToolArgs>>;
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
  if (args === actual || JSON.stringify(args) === JSON.stringify(actual)) return { args };

  const policyArgsRef = globalThis.crypto.randomUUID();
  const previous = scope.$getValue('innerCallPolicyArgs') as
    | InnerCallPolicyState['innerCallPolicyArgs']
    | undefined;
  if (previous !== undefined && Object.hasOwn(previous, policyArgsRef)) {
    throw new Error('An inner call policy reference was already assigned.');
  }
  markPrivateFields(scope, [{ root: 'innerCallPolicyArgs', path: '' }]);
  scope.$setValue('innerCallPolicyArgs', { ...previous, [policyArgsRef]: actual });
  return { args, policyArgsRef };
}

/** Read only for a tool-call permission request. Missing private state fails admission closed. */
export function policyArgsOf(scope: InnerCallPolicyScope, call: InnerCallRan): ToolArgs {
  if (call.policyArgsRef === undefined) return structuredClone(call.args);
  const stored = scope.$getValue('innerCallPolicyArgs');
  const raw =
    typeof call.policyArgsRef === 'string' && stored !== null && typeof stored === 'object'
      ? Object.getOwnPropertyDescriptor(stored, call.policyArgsRef)?.value
      : undefined;
  const taken = raw === undefined ? undefined : takeArguments(raw);
  if (taken?.kind !== 'copied') {
    throw new Error('Policy arguments from an earlier inner call are unavailable.');
  }
  return taken.args;
}
