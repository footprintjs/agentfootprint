import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import { carriedRunPolicy } from '../../../redaction/conversation.js';
import { policyInForce, privateFieldsInForce } from '../../../redaction/runRedaction.js';
import { PRIVATE_CALLER_NONE } from '../../../redaction/privateCaller.js';

/** Only positively private-only runs write none; ordinary no-policy runs change no keys. */
export function commitRunRedaction(scope: TypedScope<AgentState>): void {
  const runPolicy = policyInForce(scope);
  if (runPolicy !== undefined) scope.runRedaction = carriedRunPolicy(runPolicy);
  else if (privateFieldsInForce(scope) !== undefined) scope.runRedaction = PRIVATE_CALLER_NONE;
}
