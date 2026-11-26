/**
 * The call stage's one door to the context check: asked only when the run
 * holds a baseline store and the model the call goes to (or any model its
 * reliability chain may hand it to) is `bound` or `unknown`. An `unbound`
 * answer asks nothing, so those requests are untouched.
 */
import type { LLMProvider } from '../../../provider-contract/types.js';
import { thinkingBindingOf } from '../../../provider-contract/thinkingBinding.js';
import type { CallLLMStageDeps } from '../stages/callLLM/types.js';
import {
  checkContextBinding,
  type CheckedBinding,
  type ContextCheckOutcome,
  rememberContextBaseline,
} from './check.js';
import type { RequestComposition } from './composition.js';

export interface ContextCheckForCall {
  readonly request: RequestComposition;
  readonly outcome: ContextCheckOutcome;
}

/**
 * Asked of the provider and model THIS call goes to — the reliability chain's
 * first provider, a brain, or the agent's own — and of nothing else. A chain's
 * later providers are reached only when this one fails, and their own adapters
 * check the calls they serve; blending them in would refuse a working call.
 */
export function contextCheckFor(
  deps: Pick<CallLLMStageDeps, 'contextBinding' | 'servedTools'>,
  provider: LLMProvider,
  model: string,
  request: Omit<RequestComposition, 'parties'>,
): ContextCheckForCall | undefined {
  const holder = deps.contextBinding;
  if (holder === undefined) return undefined;
  const binding = thinkingBindingOf(provider, model);
  if (binding.binding === 'unbound') return undefined;
  const full: RequestComposition = {
    ...request,
    ...(deps.servedTools !== undefined && { parties: deps.servedTools.current }),
  };
  return {
    request: full,
    outcome: checkContextBinding(holder, {
      ...full,
      provider: provider.name,
      model,
      binding: binding as CheckedBinding,
      bindingOf: (writer) => thinkingBindingOf(provider, writer),
    }),
  };
}

/** After the response is accepted: a signed response becomes the run's baseline. */
export function rememberForCall(
  deps: Pick<CallLLMStageDeps, 'contextBinding'>,
  check: ContextCheckForCall | undefined,
  response: Parameters<typeof rememberContextBaseline>[2],
): void {
  if (check !== undefined && deps.contextBinding !== undefined)
    rememberContextBaseline(deps.contextBinding, check.request, response);
}
