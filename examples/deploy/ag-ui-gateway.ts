/**
 * deploy/ag-ui-gateway — AG-UI behind a gateway that speaks its own request
 * body and its own envelope.
 *
 * A gateway in front of the agent sends ITS request body (not an AG-UI
 * `RunAgentInput`) and expects its own output envelope —
 * `{"eventType":"TextMessageContentEvent","event":{…, "eventSequence": n}}` —
 * not plain AG-UI frames. `agUi()` takes both as strategies and keeps
 * everything else:
 *
 *   reader   the gateway's body → the turn it asks for (mapping only — the
 *            core still refuses a system message, an unlisted frontend tool,
 *            state no validator accepted, a malformed id);
 *   framing  each AG-UI event → the gateway's envelope. `eventSequence` is the
 *            frame's number in ITS stream, counted by the host per run and
 *            handed to the framing — the framing keeps no counter, so two runs
 *            at once never share one.
 *
 * The gateway also forwards a per-request credential (`x-crm-token`). The
 * host seals it for that request's run (`sealRequest`), and a
 * `requestCredentials` provider hands it to the one tool that declares it.
 * It never reaches a frame.
 *
 * Two callers post at the same time, against the mock provider. No key, no
 * network, no server socket.
 *
 * Run:  npm run example -- examples/deploy/ag-ui-gateway.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { memorySessions, streamHandler, verifiedThreads } from '../../src/doors/hosting.js';
import { requestContext, requestCredentials } from '../../src/doors/security.js';
import type { SseFraming } from '../../src/doors/observe.js';
import { agUi, type AgUiEvent, type AgUiRequestReader } from '../../src/doors/ag-ui.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/ag-ui-gateway',
  title: 'AG-UI behind a gateway — its own request body, its own envelope',
  group: 'deploy',
  description:
    'agUi({ reader, framing }): a gateway’s own request body read into an AG-UI turn (the core’s untrusted-input rules unchanged), each AG-UI event written in the gateway’s envelope with a per-run eventSequence counted by the host, and a per-request credential sealed for its own run with sealRequest.',
  defaultInput: 'Is the Acme account active?',
  providerSlots: ['default'],
  tags: ['deploy', 'ag-ui', 'gateway', 'streaming', 'protocol', 'hosting', 'credentials'],
};

// #region reader
/** The gateway's request body. */
interface GatewayBody {
  readonly conversationId?: unknown;
  readonly requestId?: unknown;
  readonly text?: unknown;
  /** An answer to the interrupt a paused run is waiting on. */
  readonly answer?: { readonly interruptId?: unknown; readonly value?: unknown };
}

/**
 * The gateway's body → the AG-UI turn. Mapping only: whatever this returns is
 * checked by the same core as a `RunAgentInput` — the ids' format, the roles,
 * the tools, `state` and `context` — before anything runs.
 */
export const gatewayReader: AgUiRequestReader = ({ body }) => {
  const b = (typeof body === 'object' && body !== null ? body : {}) as GatewayBody;
  return {
    threadId: String(b.conversationId ?? ''),
    runId: String(b.requestId ?? ''),
    messages: [{ id: 'gateway-message', role: 'user', content: String(b.text ?? '') }],
    ...(b.answer !== undefined && {
      resume: [
        { interruptId: String(b.answer.interruptId), status: 'resolved', payload: b.answer.value },
      ],
    }),
  };
};
// #endregion reader

// #region framing
/** `RUN_STARTED` → `RunStartedEvent`: the gateway's name for an AG-UI event type. */
const gatewayName = (type: string): string =>
  `${type
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')}Event`;

/**
 * Each AG-UI event in the gateway's envelope. `sequence` is the frame's number
 * in its own stream — the host counts it per run; this framing keeps nothing.
 */
export const gatewayEnvelope: SseFraming<AgUiEvent> = {
  contentType: 'text/event-stream',
  frame: (event, { sequence }) =>
    `data: ${JSON.stringify({
      eventType: gatewayName(event.type),
      event: { ...event, eventSequence: sequence },
    })}\n\n`,
};
// #endregion framing

/** The CRM the tool calls — it checks the caller's own token. */
export const crm = {
  calls: [] as string[],
  lookup(headers: Record<string, string>, name: string): string {
    const token = headers.authorization?.replace(/^Bearer /, '') ?? '';
    crm.calls.push(token);
    if (!token.startsWith('crm-token-')) throw new Error('crm: unauthorized');
    return `${name}: active`;
  },
};

const crmLookup = defineTool({
  name: 'crm_lookup',
  description: 'Look an account up in the CRM.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  needs: { credential: 'crm' }, // the request's own credential, vended by the provider below
  execute: async ({ name }: { name: string }, ctx) => crm.lookup(ctx.credential!.toHeaders(), name),
});

// #region serve
/** The gateway's user, proven by a token the gateway forwards. A real app passes its IdP. */
const verify = async (token: string) => {
  if (!token.startsWith('user-')) throw new Error('unknown token');
  return { userId: token.slice('user-'.length) };
};

/** The whole server side: one handler, mounted at any route of any framework. */
export function serve(provider: () => LLMProvider) {
  // At boot — one provider for every request, holding no secret.
  const credentials = requestCredentials({ services: { crm: 'crmToken' } });
  return streamHandler({
    agent: () =>
      Agent.create({ provider: provider(), model: 'mock', credentials })
        .system('Answer account questions with the CRM.')
        .tool(crmLookup)
        .build(),
    adapter: agUi({ reader: gatewayReader, framing: gatewayEnvelope }),
    threads: verifiedThreads({ verify }),
    sessions: memorySessions(),
    // Per request — the credential the gateway forwarded, sealed for THIS run.
    sealRequest: ({ headers }) =>
      headers['x-crm-token'] === undefined
        ? undefined
        : requestContext({ secrets: { crmToken: headers['x-crm-token'] } }),
  });
}
// #endregion serve

/** One gateway request; the envelopes it reads back. */
export async function post(
  handler: (request: Request) => Promise<Response>,
  user: string,
  body: Record<string, unknown>,
): Promise<{ status: number; wire: string; envelopes: Record<string, unknown>[] }> {
  const response = await handler(
    new Request('http://localhost/gateway/agent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer user-${user}`,
        'x-crm-token': `crm-token-${user}`,
      },
      body: JSON.stringify(body),
    }),
  );
  const wire = await response.text();
  const envelopes = wire
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>);
  return { status: response.status, wire, envelopes };
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const llm = () =>
    provider ??
    mock({
      chunkDelayMs: 0,
      replies: [
        { content: '', toolCalls: [{ id: 'c1', name: 'crm_lookup', args: { name: 'Acme' } }] },
        'The Acme account is active.',
      ],
    });
  const handler = serve(llm);
  crm.calls.length = 0;
  // Two callers at once — each run its own credential and its own sequence.
  const [ada, bo] = await Promise.all([
    post(handler, 'ada', { conversationId: 'c-1', requestId: 'r-1', text: input }),
    post(handler, 'bo', { conversationId: 'c-1', requestId: 'r-2', text: input }),
  ]);
  const sequences = (envelopes: Record<string, unknown>[]) =>
    envelopes.map((e) => (e.event as { eventSequence: number }).eventSequence);
  const proof = {
    sequencesFromOne: [ada, bo].every((r) => sequences(r.envelopes).every((n, i) => n === i + 1)),
    crmSawEachCallersToken: [...crm.calls].sort().join() === 'crm-token-ada,crm-token-bo',
    tokenOnTheWire: [ada, bo].some((r) => r.wire.includes('crm-token-')),
  };
  if (!proof.sequencesFromOne || !proof.crmSawEachCallersToken || proof.tokenOnTheWire)
    throw new Error(`ag-ui-gateway: a stated guarantee did not hold: ${JSON.stringify(proof)}`);
  return {
    status: ada.status,
    eventTypes: ada.envelopes.map((e) => e.eventType),
    firstEnvelope: ada.envelopes[0],
    ...proof,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
