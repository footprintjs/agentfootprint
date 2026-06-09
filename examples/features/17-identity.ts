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
 * Run:  npx tsx examples/features/17-identity.ts
 */

import { Agent, mock, defineTool, type LLMProvider } from '../../src/index.js';
import { staticTokens, isCredentialToken, type CredentialProvider } from '../../src/identity.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/17-identity',
  title: 'Identity — a tool vends a downstream OAuth credential (AgentCore)',
  group: 'features',
  description:
    'CredentialProvider port: a tool calls getCredential() for a downstream service. staticTokens() offline; agentCoreIdentity() in prod. 2LO returns a token; 3LO surfaces a consent URL. The token is used locally and never enters the trace.',
  defaultInput: 'list my repos',
  providerSlots: ['default'],
  tags: ['feature', 'identity', 'agentcore', 'credentials', 'security', 'oauth'],
};

const SECRET = 'ghp_demo_token_value';

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // Dev: canned token. Prod: `agentCoreIdentity({ region: 'us-east-1' })` — same port.
  const credentials: CredentialProvider = staticTokens({ github: SECRET });

  let usedHeader = '';
  const listRepos = defineTool({
    name: 'list_repos',
    description: "List the user's GitHub repositories.",
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const cred = await credentials.getCredential({
        service: 'github',
        mode: 'user',
        scopes: ['repo'],
      });
      if (cred.status === 'authorization-required') {
        // 3LO: hand the URL to the user (in a real app, pause the run here).
        return `Please authorize access: ${cred.authorizationUrl}`;
      }
      // Use the token LOCALLY — never `scope.setValue(...)` it.
      usedHeader = `Bearer ${cred.token.slice(0, 4)}…`;
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

  const agent = Agent.create({ provider: picked, model: 'mock', maxIterations: 3 })
    .tools([listRepos])
    .build();
  const answer = await agent.run({ message: input });

  // Demonstrate the security guarantee: the secret token is NOT in the snapshot.
  const tokenInSnapshot = JSON.stringify(agent.getSnapshot() ?? {}).includes(SECRET);
  return {
    answer,
    usedHeader, // proves the tool actually used the token
    tokenInSnapshot, // false — the vended token never reached the trace
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
