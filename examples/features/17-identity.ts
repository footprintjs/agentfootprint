/**
 * 17 — Identity: a tool vends a downstream credential (AWS Bedrock AgentCore).
 *
 * A tool calls `credentials.getCredential({ service })` to get a token for a
 * downstream API. `staticTokens()` runs offline; `agentCoreIdentity({ region })`
 * is the production swap — the tool code never changes.
 *
 *   - mode 'machine' (2LO) → token returned directly.
 *   - mode 'user'    (3LO) → may return `authorization-required` with a consent
 *     URL to surface to the user (e.g. pause the run), then retry after consent.
 *
 * SECURITY: the token is used LOCALLY inside `execute` (as a header) and is never
 * written to tracked scope — so it stays out of the snapshot / narrative. This
 * example proves it: `tokenInSnapshot` is `false`.
 *
 * RESILIENCE: production identity backends blip (AgentCore documents 500/429
 * as retryable). `withCredentialRetry` wraps the provider so transient failures
 * retry with backoff BEFORE failing closed — same vocabulary as the LLM-provider
 * `withRetry`. This example simulates one blip; `credentialRetries` is `1`.
 *
 * Run:  npx tsx examples/features/17-identity.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js'
import { mock } from '../../src/llm-providers.js';
import { staticTokens, withCredentialRetry, type CredentialProvider } from '../../src/identity.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/17-identity',
  title: 'Identity — a tool vends a downstream OAuth credential (AgentCore)',
  group: 'features',
  description:
    'Declare-and-push: the tool declares needs:{credential}; the framework resolves it BEFORE execute and injects ctx.credential. staticTokens() offline; agentCoreIdentity() in prod (one-line swap). withCredentialRetry() retries transient vault blips before failing closed. 3LO consent surfaces a URL; the credential never enters the trace.',
  defaultInput: 'list my repos',
  providerSlots: ['default'],
  tags: ['feature', 'identity', 'agentcore', 'credentials', 'security', 'oauth'],
};

const SECRET = 'ghp_demo_token_value';

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // Dev: canned token. Prod: `agentCoreIdentity({ region: 'us-east-1' })` — same port.
  const vault: CredentialProvider = staticTokens({ github: SECRET });

  // TRANSIENT-RETRY: simulate one network blip on the way to the vault, then
  // wrap with `withCredentialRetry`. 3LO consent and 4xx are never retried;
  // exhausted retries fail closed exactly like an unwrapped provider.
  let vaultCalls = 0;
  const flakyVault: CredentialProvider = {
    id: 'flaky-vault',
    getCredential: (req) => {
      vaultCalls++;
      if (vaultCalls === 1) {
        return Promise.reject(Object.assign(new Error('ETIMEDOUT: vault blip'), { status: 503 }));
      }
      return vault.getCredential(req);
    },
  };
  const retriesObserved: number[] = [];
  const credentials = withCredentialRetry(flakyVault, {
    maxAttempts: 3,
    initialDelayMs: 5,
    onRetry: (_err, attempt) => retriesObserved.push(attempt), // per-attempt visibility
  });

  // DECLARE-AND-PUSH: the tool declares `needs`; the framework resolves it BEFORE
  // execute and injects `ctx.credential`. No fetching, no globals, no boilerplate
  // — and the credential is NOT in inputSchema, so the LLM never sees it.
  let usedHeader = '';
  const listRepos = defineTool({
    name: 'list_repos',
    description: "List the user's GitHub repositories.",
    inputSchema: { type: 'object', properties: {} },
    needs: { credential: 'github', mode: 'user', scopes: ['repo'] }, // ← declare
    execute: async (_args, ctx) => {
      // `ctx.credential` was pushed in by the framework. Apply it LOCALLY via the
      // universal toHeaders() — never store it in scope.
      usedHeader = ctx.credential
        ? `${ctx.credential.kind} (${Object.keys(ctx.credential.toHeaders())[0]})`
        : '(none)';
      return 'repos: agentfootprint, neo-agentfootprint';
    },
  });

  const picked =
    provider ??
    mock({
      replies: [
        { content: 'fetching repos', toolCalls: [{ id: 'c1', name: 'list_repos', args: {} }] },
        { content: 'You have 2 repos: agentfootprint, neo-agentfootprint.', toolCalls: [] },
      ],
    });

  // Attach the provider once; swap staticTokens → agentCoreIdentity in one line.
  const agent = Agent.create({ provider: picked, model: 'mock', maxIterations: 3, credentials })
    .tools([listRepos])
    .build();
  const answer = await agent.run({ message: input });

  // Demonstrate the security guarantee: the secret token is NOT in the snapshot.
  const tokenInSnapshot = JSON.stringify(agent.getSnapshot() ?? {}).includes(SECRET);
  return {
    answer,
    usedHeader, // proves the tool actually used the token
    tokenInSnapshot, // false — the vended token never reached the trace
    credentialRetries: retriesObserved.length, // 1 — the blip was retried, not failed closed
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
