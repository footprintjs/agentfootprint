/**
 * withCredentialRetry — CredentialProvider decorator that retries transient
 * `getCredential` failures with exponential backoff.
 *
 * Pattern: Decorator (GoF) — the credential twin of `withRetry` (resilience)
 *          for LLM providers. SAME option vocabulary (`maxAttempts` /
 *          `initialDelayMs` / `backoffFactor` / `maxDelayMs` / `shouldRetry` /
 *          `onRetry`) and the SAME default transience policy (the shared
 *          `defaultShouldRetry`: skip AbortError + 4xx except 429; retry 5xx,
 *          network errors, unknown shapes). AgentCore's documented transient
 *          errors (`InternalServerException` 500, `ThrottlingException` 429)
 *          retry out of the box.
 *
 * Why a decorator and not a reliability rule: the rules-based reliability
 * subsystem (`Agent.create(...).reliability({...})`) is LLM-call-scoped —
 * `ReliabilityScope` carries `request: LLMRequest` and the gate chart loops
 * around the CallLLM stage with provider failover. Credential resolution
 * happens at a different boundary (the tool-dispatch loop, declare-and-push);
 * promoting it to a chart-level gate is the deferred `sf-credential` node.
 * Until that exists, retry is a TRANSPORT property of the credential provider
 * — exactly like `withRetry` is for LLM transports.
 *
 * Semantics:
 *   • Only THROWN errors retry. Both result branches return immediately:
 *     `issued` is success; `authorization-required` is a HUMAN flow (3LO
 *     consent), not a transient fault — retrying it would hammer the IdP
 *     without the user having authorized anything.
 *   • After retries exhaust, the LAST error is rethrown — the call site
 *     behaves byte-identically to an unwrapped provider (fail-closed:
 *     `agentfootprint.credential.failed` emit + error tool result; the tool
 *     does NOT run).
 *   • Visibility: the agent trace brackets the whole retried resolution with
 *     `credential.requested` → `credential.acquired` / `credential.failed`.
 *     Per-attempt visibility is consumer-wired via `onRetry` — the established
 *     decorator contract (same as `withRetry`; the `agentfootprint.error.*`
 *     event family is reserved for these decorators, see events/payloads.ts).
 *     No new event types.
 *
 * @example
 *   import { agentCoreIdentity, withCredentialRetry } from 'agentfootprint/identity';
 *
 *   const credentials = withCredentialRetry(agentCoreIdentity({ region: 'us-east-1' }), {
 *     maxAttempts: 3,
 *     onRetry: (err, attempt, ms) => console.warn(`credential retry ${attempt} in ${ms}ms`, err),
 *   });
 *   const agent = Agent.create({ provider, model, credentials }).tools([...]).build();
 */

import { defaultShouldRetry, type WithRetryOptions } from '../resilience/withRetry.js';
import type { CredentialProvider, CredentialRequest, CredentialResult } from './types.js';

/**
 * Same vocabulary as the LLM-provider `withRetry` — one retry language across
 * both decorators. `shouldRetry` sees only THROWN errors (never an
 * `authorization-required` result, which returns immediately).
 */
export type WithCredentialRetryOptions = WithRetryOptions;

/**
 * Wrap a {@link CredentialProvider} so transient `getCredential` failures
 * retry with exponential backoff before failing closed.
 *
 * Defaults mirror `withRetry`: 3 attempts total, 200ms → 400ms → 800ms
 * backoff capped at 10s, retry on 5xx/429/network/unknown, never on
 * AbortError or other 4xx.
 */
export function withCredentialRetry(
  provider: CredentialProvider,
  options: WithCredentialRetryOptions = {},
): CredentialProvider {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const initialDelayMs = options.initialDelayMs ?? 200;
  const backoffFactor = options.backoffFactor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const onRetry = options.onRetry;

  return {
    id: `${provider.id}+retry`,
    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // Both result branches return as-is (same object — the wrapper never
          // clones or serializes the credential): `issued` is success;
          // `authorization-required` is consent, not a fault — never retried.
          return await provider.getCredential(req);
        } catch (err) {
          lastError = err;
          if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
            throw err;
          }
          const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, attempt - 1));
          onRetry?.(err, attempt + 1, delay);
          await sleep(delay);
        }
      }
      // Unreachable — the last attempt either returned or threw above.
      throw lastError;
    },
  };
}

// `CredentialRequest` carries no AbortSignal (port contract), so this sleep is
// the signal-less twin of withRetry's. If the port ever grows a signal, mirror
// withRetry's abort-aware sleep here.
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
