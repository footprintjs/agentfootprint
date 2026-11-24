import { captureProviderResponse } from '../../provider-contract/responseAdmission.js';
import type { TypedScope } from 'footprintjs';
import type { LLMMessage, LLMRequest } from '../../provider-contract/types.js';
import { callUnder } from '../../lib/abort.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { resilienceHooks } from '../../recorders/core/resilienceHooks.js';
import type { ParallelState, MergeWithLLMOptions } from './types.js';
import {
  requireUsableProviderResponse,
  admitInterventionError,
} from '../../core/providerIntervention.js';

// ─── Helpers ──────────────────────────────────────────────────────────

export async function mergeWithLLM(
  scope: TypedScope<ParallelState>,
  opts: MergeWithLLMOptions,
  results: Readonly<Record<string, string>>,
): Promise<string> {
  // XML-escape branch content to avoid prompt-injection via branch output.
  const sections = Object.entries(results)
    .map(([id, content]) => `<${id}>${xmlEscape(content)}</${id}>`)
    .join('\n');
  const userContent = `${opts.prompt}\n\n${sections}`;
  const messages: LLMMessage[] = [{ role: 'user', content: userContent }];

  typedEmit(scope, 'agentfootprint.stream.llm_start', {
    iteration: 1,
    provider: opts.provider.name,
    model: opts.model,
    systemPromptChars: 0,
    messagesCount: 1,
    toolsCount: 0,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
  });
  const startMs = Date.now();
  const request: LLMRequest = {
    messages,
    model: opts.model,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
  };
  // The run's signal rides the request and bounds the wait; an answer that
  // lands after it is refused before `llm_end` could count it
  // (lib/abort.ts · callUnder).
  const response = captureProviderResponse(
    await callUnder(request, scope.$getEnv?.()?.signal, (wired) =>
      opts.provider.complete(
        wired,
        // Resilience-report channel: a decorated merge provider's fallback /
        // retry / recovery becomes an in-run typed event here.
        resilienceHooks(scope),
      ),
    ).catch((error: unknown) => admitInterventionError(scope, error)),
  );
  const notifyCompleted = () =>
    typedEmit(scope, 'agentfootprint.stream.llm_end', {
      iteration: 1,
      content: response.content,
      toolCallCount: response.toolCalls.length,
      usage: response.usage,
      stopReason: response.stopReason,
      durationMs: Date.now() - startMs,
    });
  requireUsableProviderResponse(scope, response, notifyCompleted);
  notifyCompleted();
  return response.content;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
