/**
 * consentRequestId — how a consent request's id is derived from the call it
 * commits to (`consentRequest.ts` · "WHY THE ID IS A COMMITMENT").
 *
 * Pattern: one pure function. Role: the one derivation the mint, the resume's
 * check and `runsAsAsked` share, so they cannot disagree about what was bound.
 *
 * `id = sha256(domain ‖ nonce ‖ canonicalJson(call))`. A field the call does
 * not carry is left out of the JSON (an `undefined` property is absent), so a
 * field added later changes no id that does not carry it: a check-in's hidden
 * names are bound only when there are some (`checkInHiddenArgs.ts` ·
 * `boundHiddenArgs`), and a tool without a view keeps the id it had before.
 */
import { hasWholeArgumentValue, hidesWholeArgumentValue } from '../lib/argumentDisplay.js';
import { canonicalJson } from '../lib/canonicalJson.js';
import { isJsonFaithful } from '../lib/jsonFaithful.js';
import { sha256Hex } from '../lib/sha256.js';
import { boundHiddenArgs } from './checkInHiddenArgs.js';
import type { GatedCall } from './consentRequest.js';

const DOMAIN = 'agentfootprint/consent-request/v1';

/** Bind named records and the whole value explicitly withheld by a check-in. */
export function canBindConsentArguments(args: unknown, call: GatedCall): boolean {
  return (
    (typeof args === 'object' && args !== null && !Array.isArray(args)) ||
    (call.gate === 'checkIn' && hidesWholeArgumentValue(args, call.hiddenArgs))
  );
}

/** The request's id for `call` under `nonce`, or `undefined` when the call is not faithful JSON. */
export function requestIdOf(nonce: string, call: GatedCall): string | undefined {
  if (hasWholeArgumentValue(call.args) && !canBindConsentArguments(call.args, call))
    return undefined;
  const body = {
    gate: call.gate,
    tool: call.tool,
    toolCallId: call.toolCallId,
    party: call.party,
    args: call.args,
    hiddenArgs: boundHiddenArgs(call.hiddenArgs),
    middleware: call.middleware,
    askIndex: call.askIndex,
    chain: call.chain,
  };
  if (!isJsonFaithful(body)) return undefined;
  return sha256Hex(`${DOMAIN}\u001f${nonce}\u001f${canonicalJson(body)}`);
}
