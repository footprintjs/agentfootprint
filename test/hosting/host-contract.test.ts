/**
 * The portability proof: one handler, three hosts, identical outputs.
 *
 * `nodeHost` binds a real socket and is driven with `fetch`. The second host is
 * written right here, in ~60 lines, delivers requests by calling the handler in
 * process, and deliberately declares NO capabilities — so the buffering path
 * ("this host cannot stream; the completion is authoritative") is exercised for
 * real rather than assumed.
 *
 * The third is `agentCoreRuntimeHost` — a CLOUD runtime's container contract,
 * and the reason the suite was written before any cloud adapter existed. It
 * binds a real socket too, speaks different paths and different JSON, reads its
 * conversation id out of a header instead of a body, and every assertion below
 * holds for it unchanged. That is the whole thesis, executable: **a cloud
 * adapter is vendor paths plus a header mapping on a port that already worked.**
 * Nothing in `src/hosting/types.ts` changed to let it pass.
 *
 * All three run the same conformance suite, and then a final pair of tests
 * invokes all of them with the same requests and compares the observations
 * directly. That comparison is the claim in one line: if a future adapter
 * changes an answer, this file goes red.
 */

import { describe, expect, it } from 'vitest';

import { nodeHost } from '../../src/hosting/index.js';
import type { PendingAsk } from '../../src/hosting/index.js';
import type { NodeHostHandle } from '../../src/hosting/nodeHost.js';
import {
  agentCoreRuntimeHost,
  foundryResponsesHost,
  agentCoreA2AHost,
} from '../../src/hosting-providers.js';
import { inProcessHost, type InProcessHost } from './testHost.js';
import {
  contractHandler,
  describeHostContract,
  expectedOutput,
  type ContractRequest,
  type HostObservation,
  type HostUnderTest,
} from './hostContract.js';

// ─── Subject 1: the shipped node:http adapter ────────────────────────

const nodeSubject: HostUnderTest = {
  label: 'nodeHost (node:http)',
  create: () => nodeHost({ port: 0, hostname: '127.0.0.1' }),
  invoke: async (handle, request) => {
    const { url } = handle as NodeHostHandle;
    let response: Response;
    try {
      response = await fetch(`${url}/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(request.stream ? { accept: 'text/event-stream' } : {}),
          ...(request.headers ?? {}),
        },
        body: JSON.stringify({
          input: request.input,
          ...(request.sessionId !== undefined && { sessionId: request.sessionId }),
        }),
      });
    } catch (err) {
      // A socket that is gone is a refusal too — the host stopped listening.
      return { error: `is closed (${(err as Error).message})`, chunks: [] };
    }
    const body = await response.text();
    return response.headers.get('content-type')?.includes('text/event-stream')
      ? parseSSE(body)
      : parseJson(body);
  },
};

function parseJson(body: string): HostObservation {
  const parsed = JSON.parse(body) as {
    output?: string;
    error?: string;
    code?: string;
    awaiting?: PendingAsk;
  };
  return {
    ...(parsed.output !== undefined && { output: parsed.output }),
    ...(parsed.error !== undefined && { error: parsed.error }),
    ...(parsed.code !== undefined && { code: parsed.code }),
    ...(parsed.awaiting !== undefined && { awaiting: parsed.awaiting }),
    chunks: [],
  };
}

function parseSSE(body: string): HostObservation {
  const chunks: string[] = [];
  let output: string | undefined;
  let error: string | undefined;
  let code: string | undefined;
  let awaiting: PendingAsk | undefined;
  for (const frame of body.split('\n\n')) {
    const name = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!name || !data) continue;
    const payload = JSON.parse(data) as {
      text?: string;
      output?: string;
      message?: string;
      awaiting?: PendingAsk;
    };
    if (name === 'chunk' && typeof payload.text === 'string') chunks.push(payload.text);
    if (name === 'complete') output = payload.output;
    if (name === 'awaiting') awaiting = payload.awaiting;
    if (name === 'error') {
      const asError = JSON.parse(data) as { error?: string; code?: string };
      error = asError.error;
      code = asError.code;
    }
  }
  return {
    ...(output !== undefined && { output }),
    ...(error !== undefined && { error }),
    ...(code !== undefined && { code }),
    ...(awaiting !== undefined && { awaiting }),
    chunks,
  };
}

// ─── Subject 3: a real cloud runtime's container contract ────────────
//
// Different paths (`/invocations`, `/ping`), different body fields (`prompt` in,
// `response` out), and the conversation id in a header rather than the body.
// Same handler, same suite, same answers.

const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

const agentCoreSubject: HostUnderTest = {
  label: 'agentCoreRuntimeHost (container contract)',
  create: () => agentCoreRuntimeHost({ port: 0, hostname: '127.0.0.1' }),
  invoke: async (handle, request) => {
    const { url } = handle as NodeHostHandle;
    let response: Response;
    try {
      response = await fetch(`${url}/invocations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(request.stream ? { accept: 'text/event-stream' } : {}),
          ...(request.headers ?? {}),
          // The one mapping this adapter adds: the session id is a header here.
          ...(request.sessionId !== undefined ? { [SESSION_HEADER]: request.sessionId } : {}),
        },
        body: JSON.stringify({ prompt: request.input }),
      });
    } catch (err) {
      return { error: `is closed (${(err as Error).message})`, chunks: [] };
    }
    const body = await response.text();
    return response.headers.get('content-type')?.includes('text/event-stream')
      ? parseAgentCoreSSE(body)
      : parseAgentCoreJson(body);
  },
};

/** `{ response, status }` / `{ error, status, code? }` back into port vocabulary. */
function parseAgentCoreJson(body: string): HostObservation {
  const parsed = JSON.parse(body) as {
    response?: string;
    error?: string;
    code?: string;
    awaiting?: PendingAsk;
  };
  return {
    ...(parsed.response !== undefined && { output: parsed.response }),
    ...(parsed.error !== undefined && { error: parsed.error }),
    ...(parsed.code !== undefined && { code: parsed.code }),
    ...(parsed.awaiting !== undefined && { awaiting: parsed.awaiting }),
    chunks: [],
  };
}

function parseAgentCoreSSE(body: string): HostObservation {
  const chunks: string[] = [];
  let output: string | undefined;
  let error: string | undefined;
  let code: string | undefined;
  let awaiting: PendingAsk | undefined;
  for (const frame of body.split('\n\n')) {
    const name = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!name || !data) continue;
    const payload = JSON.parse(data) as {
      chunk?: string;
      response?: string;
      error?: string;
      code?: string;
      awaiting?: PendingAsk;
    };
    if (name === 'chunk' && typeof payload.chunk === 'string') chunks.push(payload.chunk);
    if (name === 'complete') output = payload.response;
    if (name === 'awaiting') awaiting = payload.awaiting;
    if (name === 'error') {
      error = payload.error;
      code = payload.code;
    }
  }
  return {
    ...(output !== undefined && { output }),
    ...(error !== undefined && { error }),
    ...(code !== undefined && { code }),
    ...(awaiting !== undefined && { awaiting }),
    chunks,
  };
}

// ─── Subject 4: a hosted-agent contract in somebody else's protocol ──
//
// The fourth adapter differs from the third in a way the port had never been
// asked about: it does not merely rename the fields, it frames the STREAM
// differently — nine named lifecycle events instead of one `chunk` per piece —
// and it decides to stream from the BODY rather than the `Accept` header. Every
// assertion in the suite holds for it unchanged, which is the claim: a protocol
// with a different SHAPE is still a wire, not a second host.

const foundrySubject: HostUnderTest = {
  label: 'foundryResponsesHost (Responses protocol)',
  create: () => foundryResponsesHost({ port: 0, hostname: '127.0.0.1' }),
  // A public door: an uncaught exception's words do not travel. See the flag's
  // note on hostContract.HostUnderTest.
  sanitizesThrownErrors: true,
  invoke: async (handle, request) => {
    const { url } = handle as NodeHostHandle;
    let response: Response;
    try {
      response = await fetch(`${url}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(request.headers ?? {}) },
        body: JSON.stringify({
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: request.input }],
            },
          ],
          // The dialect's own signal — no `Accept` header anywhere.
          ...(request.stream === true ? { stream: true } : {}),
          ...(request.sessionId !== undefined ? { conversation: request.sessionId } : {}),
        }),
      });
    } catch (err) {
      return { error: `is closed (${(err as Error).message})`, chunks: [] };
    }
    const body = await response.text();
    return response.headers.get('content-type')?.includes('text/event-stream')
      ? parseResponsesSSE(body)
      : parseResponsesJson(body);
  },
};

/** A `response` object, or an error envelope, back into port vocabulary. */
function parseResponsesJson(body: string): HostObservation {
  const parsed = JSON.parse(body) as {
    status?: string;
    output?: { content?: { text?: string }[] }[];
    error?: { message?: string; code?: string } | null;
  };
  const text = parsed.output?.[0]?.content?.[0]?.text;
  return {
    ...(parsed.status === 'completed' && text !== undefined ? { output: text } : {}),
    ...(parsed.error ? { error: parsed.error.message ?? '', code: parsed.error.code } : {}),
    chunks: [],
  };
}

/** The nine-event lifecycle back into port vocabulary. */
function parseResponsesSSE(body: string): HostObservation {
  const chunks: string[] = [];
  let output: string | undefined;
  let error: string | undefined;
  let code: string | undefined;
  for (const frame of body.split('\n\n')) {
    const name = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!name || !data) continue;
    const payload = JSON.parse(data) as {
      delta?: string;
      response?: {
        output?: { content?: { text?: string }[] }[];
        error?: { message?: string; code?: string } | null;
      };
    };
    if (name === 'response.output_text.delta' && typeof payload.delta === 'string') {
      chunks.push(payload.delta);
    }
    if (name === 'response.completed') {
      output = payload.response?.output?.[0]?.content?.[0]?.text;
    }
    if (name === 'response.failed') {
      error = payload.response?.error?.message ?? '';
      code = payload.response?.error?.code;
    }
  }
  return {
    ...(output !== undefined && { output }),
    ...(error !== undefined && { error }),
    ...(code !== undefined && { code }),
    chunks,
  };
}

// ─── Subject 5: an OPEN protocol, on a runtime's container contract ──
//
// The fifth adapter is the first whose envelope is not ours at all: JSON-RPC
// 2.0, where the reply must echo the request's `id` and the answer is buried in
// an artifact rather than named as an output. Every assertion in the suite
// holds for it unchanged, which is the point being made for the third time —
// the port did not move.

const a2aSubject: HostUnderTest = {
  label: 'agentCoreA2AHost (A2A / JSON-RPC 2.0)',
  create: () =>
    agentCoreA2AHost({
      card: { name: 'contract', description: 'the shared handler', version: '1.0.0' },
      port: 0,
      hostname: '127.0.0.1',
    }),
  // A public door: an uncaught exception's words do not travel.
  sanitizesThrownErrors: true,
  invoke: async (handle, request) => {
    const { url } = handle as NodeHostHandle;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(request.headers ?? {}),
          ...(request.sessionId !== undefined
            ? { 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': request.sessionId }
            : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'contract-1',
          method: 'message/send',
          params: {
            message: {
              role: 'user',
              parts: [{ kind: 'text', text: request.input }],
              messageId: 'contract-msg',
            },
          },
        }),
      });
    } catch (err) {
      return { error: `is closed (${(err as Error).message})`, chunks: [] };
    }
    return parseA2A(await response.text());
  },
};

/** A JSON-RPC envelope back into port vocabulary. */
function parseA2A(body: string): HostObservation {
  let parsed: {
    result?: { artifacts?: { parts?: { text?: string }[] }[] };
    error?: { code?: number; message?: string };
  };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    // A body that is not JSON at all is still a refusal a caller can see.
    return { error: body || 'empty response', chunks: [] };
  }
  const text = parsed.result?.artifacts?.[0]?.parts?.[0]?.text;
  return {
    ...(text !== undefined && { output: text }),
    ...(parsed.error ? { error: parsed.error.message ?? '' } : {}),
    // A2A carries no incremental delivery on this wire — the host declares
    // streaming, but `message/send` has nowhere to put a chunk, so a caller
    // observes none. The suite asserts chunks against the CAPABILITY, so this
    // subject would fail if it claimed to stream.
    chunks: [],
  };
}

// ─── Subject 2: the minimal in-process host (see ./testHost.ts) ──────

let latest: InProcessHost | undefined;
const inProcessSubject: HostUnderTest = {
  label: 'in-process test host (no capabilities)',
  create: () => {
    latest = inProcessHost();
    return latest;
  },
  invoke: (_handle, request) => latest!.deliver(request),
};

// ─── Every host, the same contract ───────────────────────────────────

describeHostContract(nodeSubject);
describeHostContract(inProcessSubject);
describeHostContract(agentCoreSubject);
describeHostContract(foundrySubject);
describeHostContract(a2aSubject);

// ─── And directly against each other ─────────────────────────────────

describe('one handler, four hosts', () => {
  const cases: ContractRequest[] = [
    { input: 'hello' },
    { input: 'with a session', sessionId: 's-1' },
    { input: 'with a header', headers: { 'x-probe': 'yes' } },
  ];
  const subjects = [nodeSubject, inProcessSubject, agentCoreSubject, foundrySubject];

  it('produces byte-identical answers on every host', async () => {
    for (const request of cases) {
      const observed = await Promise.all(subjects.map((s) => withHost(s, request)));
      for (const one of observed) expect(one.output).toBe(expectedOutput(request));
      // Asserted pairwise as well as against the expectation, so "all three
      // agreed with the same wrong answer" cannot pass either.
      expect(new Set(observed.map((o) => o.output)).size).toBe(1);
    }
  });

  it('reports the same failure on every host', async () => {
    const observed = await Promise.all(subjects.map((s) => withHost(s, { input: 'FAIL' })));
    for (const one of observed) {
      expect(one.output).toBeUndefined();
      expect(one.error).toBe(observed[0].error);
    }
  });

  it('the cloud adapter needed no port change to pass — it differs only in wire shape', async () => {
    // Same request, expressed in each adapter's own dialect by its own
    // `invoke`; the ANSWER is identical, which is what a port buys you.
    const request: ContractRequest = { input: 'portable', sessionId: 'c-9' };
    const overNode = await withHost(nodeSubject, request);
    const overCloud = await withHost(agentCoreSubject, request);
    expect(overCloud.output).toBe(overNode.output);
    expect(overCloud.output).toContain('session:c-9');
  });

  async function withHost(
    subject: HostUnderTest,
    request: ContractRequest,
  ): Promise<HostObservation> {
    const handle = await subject.create().serve(contractHandler);
    try {
      return await subject.invoke(handle, request);
    } finally {
      await handle.close();
    }
  }
});
