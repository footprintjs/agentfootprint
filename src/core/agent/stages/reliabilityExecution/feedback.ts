import type { LLMRequest } from '../../../../provider-contract/types.js';
import type { ReliabilityScope } from '../../../../reliability/types.js';

/**
 * v2.13 — apply a `feedbackForLLM` value to the next request by
 * appending an ephemeral user message. Resolves the value to a string
 * (sync or async); returns a NEW LLMRequest with the appended message.
 *
 * The new message is marked `ephemeral: true` so:
 *   • LLM sees it (counts toward this turn's context window)
 *   • observability (recorders / narrative / typed events) sees it
 *   • scope.history / memory writes do NOT persist it long-term
 *
 * Errors thrown by a function-form `feedbackForLLM` are caught and
 * swallowed (with a fallback to a generic message) — a buggy
 * feedback callback MUST NOT abort the agent run that the gate is
 * already retrying. This is the v2.13 7-panel review's
 * "callback-throw safety" requirement (OpenAI reviewer).
 */
export async function applyFeedback(
  request: LLMRequest,
  feedback: string | ((scope: ReliabilityScope) => string | Promise<string>),
  scope: ReliabilityScope,
): Promise<LLMRequest> {
  let content: string;
  if (typeof feedback === 'string') {
    content = feedback;
  } else {
    try {
      const result = feedback(scope);
      content = result instanceof Promise ? await result : result;
    } catch {
      content = `Previous output failed validation. Return valid JSON conforming to the schema.`;
    }
  }
  return {
    ...request,
    messages: [...request.messages, { role: 'user', content, ephemeral: true }],
  };
}
