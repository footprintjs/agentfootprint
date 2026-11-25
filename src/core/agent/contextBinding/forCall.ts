/**
 * The call stage's one door to the context check: asked only when the run
 * holds a baseline store and the model the call goes to (or any model its
 * reliability chain may hand it to) is `bound` or `unknown`. An `unbound`
 * answer asks nothing, so those requests are untouched.
 */
import type { LLMProvider } from '../../../provider-contract/types.js';
import {
  stricterBinding,
  thinkingBindingOf,
  type ThinkingBinding,
} from '../../../provider-contract/thinkingBinding.js';
import type { CallLLMStageDeps } from '../stages/callLLM/types.js';
import {
  checkContextBinding,
  type CheckedBinding,
  type ContextCheckOutcome,
  rememberContextBaseline,
} from './check.js';
import type { RequestContext } from './composition.js';

export interface ContextCheckForCall {
  readonly request: RequestContext;
  readonly outcome: ContextCheckOutcome;
}

/** The stricter answer of the provider called and every provider the reliability chain may call. */
export function bindingForCall(
  deps: Pick<CallLLMStageDeps, 'reliability'>,
  provider: LLMProvider,
  model: string,
): ThinkingBinding {
  return (deps.reliability?.providers ?? []).reduce(
    (held, r) => stricterBinding(held, thinkingBindingOf(r.provider, r.model)),
    thinkingBindingOf(provider, model),
  );
}

export function contextCheckFor(
  deps: Pick<CallLLMStageDeps, 'contextBinding' | 'reliability' | 'servedTools'>,
  provider: LLMProvider,
  model: string,
  request: Omit<RequestContext, 'parties'>,
): ContextCheckForCall | undefined {
  const holder = deps.contextBinding;
  if (holder === undefined) return undefined;
  const binding = bindingForCall(deps, provider, model);
  if (binding.binding === 'unbound') return undefined;
  const full: RequestContext = {
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
