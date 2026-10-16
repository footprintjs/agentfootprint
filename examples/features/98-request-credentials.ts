/**
 * 98 — Request credentials + host-filled tool arguments.
 *
 * A host that receives a per-request credential (here an "encrypted" token in
 * a header) seals it for ONE run with `requestContext`, and a
 * `requestCredentials` provider vends it to the tools that declare a `needs`
 * for it. The provider is built once at boot and holds no secret.
 *
 * An MCP server whose tools take a `token` argument gets that argument filled
 * by the host with `hostFilled`: the field is removed from the schema the
 * model sees, a value the model sends for it is refused by name, and the
 * token is scrubbed from anything the server echoes back.
 *
 * The example proves the guarantees it states: the model never saw a `token`
 * field, the server received the decrypted token, the model's own attempt was
 * refused, and the token is in neither the snapshot nor the narrative.
 *
 * Run:  npx tsx examples/features/98-request-credentials.ts
 */

import { Agent, fromCredential, hostFilled, type LLMProvider } from '../../src/index.js';
import { mock, mockMcpClient } from '../../src/doors/providers.js';
import { decodedWith, requestContext, requestCredentials } from '../../src/doors/security.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/98-request-credentials',
  title: 'Request credentials — a per-request token, filled into MCP tool arguments by the host',
  group: 'features',
  description:
    'requestContext seals the incoming request’s secrets for one run; requestCredentials vends them to declared needs and fails closed by name. hostFilled removes a tool argument from the model’s schema, refuses a model-sent value by name and fills it from the credential — the MCP token wrapper, in the library.',
  defaultInput: 'find the acme account',
  providerSlots: ['default'],
  tags: ['feature', 'identity', 'credentials', 'security', 'mcp'],
};

// The demo "encryption": the header carries the token reversed.
const decrypt = (sealed: string) => sealed.split('').reverse().join('');
const TOKEN = 'crm-session-token-4f1c';

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // ── At boot: one provider, no secret in it ──────────────────────────────
  const credentials = requestCredentials({
    services: { crm: { secret: 'crmToken', as: decodedWith(decrypt) } },
  });

  // An MCP server whose tool takes the token as an ARGUMENT.
  const received: Record<string, unknown>[] = [];
  const crm = mockMcpClient({
    name: 'crm-mcp',
    tools: [
      {
        name: 'find_account',
        description: 'Find a CRM account by name.',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' }, token: { type: 'string' } },
          required: ['name', 'token'],
        },
        handler: async (args: Record<string, unknown>) => {
          received.push(args);
          return `acme (looked up with ${String(args.token)})`; // a server that echoes
        },
      },
    ],
  });
  const tools = hostFilled(await crm.tools(), { token: fromCredential({ service: 'crm' }) });

  const sawTokenField: boolean[] = [];
  const picked =
    provider ??
    mock({
      respond: (req) => {
        sawTokenField.push(JSON.stringify(req.tools ?? []).includes('"token"'));
        const toolTurns = req.messages.filter((m) => m.role === 'tool').length;
        // First the model tries to set the token itself; then it calls properly.
        if (toolTurns === 0) {
          return {
            toolCalls: [{ id: 'c1', name: 'find_account', args: { name: 'acme', token: 'guess' } }],
          };
        }
        if (toolTurns === 1) {
          return { toolCalls: [{ id: 'c2', name: 'find_account', args: { name: 'acme' } }] };
        }
        return { content: 'Found the acme account.' };
      },
    });

  const agent = Agent.create({ provider: picked, model: 'mock', maxIterations: 4, credentials })
    .tools([...tools])
    .build();

  // ── Per request: seal what arrived, hand it to THIS run only ────────────
  const header = TOKEN.split('').reverse().join(''); // what the client sent
  const answer = await agent.run(
    { message: input },
    { request: requestContext({ secrets: { crmToken: header } }) },
  );

  const record =
    JSON.stringify(agent.getSnapshot() ?? {}) + JSON.stringify(agent.getLastNarrativeEntries());
  const proof = {
    modelSawTokenField: sawTokenField.some(Boolean),
    serverCalls: received.length,
    serverGotToken: received[0]?.token === TOKEN,
    tokenInRecord: record.includes(TOKEN) || record.includes(header),
  };
  // The smoke run checks the claims, not just that the file runs.
  if (
    proof.modelSawTokenField ||
    proof.serverCalls !== 1 ||
    !proof.serverGotToken ||
    proof.tokenInRecord
  ) {
    throw new Error(
      `98-request-credentials: a stated guarantee did not hold: ${JSON.stringify(proof)}`,
    );
  }
  return {
    answer,
    modelSawTokenField: sawTokenField.some(Boolean), // false — removed from the schema
    serverCalls: received.length, // 1 — the model's own attempt was refused before the call
    serverGotToken: received[0]?.token === TOKEN, // true — decrypted and filled by the host
    tokenInRecord: record.includes(TOKEN) || record.includes(header), // false
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
