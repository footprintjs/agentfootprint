/**
 * The portability proof: one handler, two hosts, identical outputs.
 *
 * `nodeHost` binds a real socket and is driven with `fetch`. The second host is
 * written right here, in ~60 lines, delivers requests by calling the handler in
 * process, and deliberately declares NO capabilities — so the buffering path
 * ("this host cannot stream; the completion is authoritative") is exercised for
 * real rather than assumed.
 *
 * Both run the same conformance suite, and then a final pair of tests invokes
 * both hosts with the same requests and compares the observations directly.
 * That comparison is the claim in one line: if a future adapter changes an
 * answer, this file goes red.
 */

import { describe, expect, it } from 'vitest';

import { nodeHost } from '../../src/hosting/index.js';
import type { NodeHostHandle } from '../../src/hosting/nodeHost.js';
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
  const parsed = JSON.parse(body) as { output?: string; error?: string; code?: string };
  return {
    ...(parsed.output !== undefined && { output: parsed.output }),
    ...(parsed.error !== undefined && { error: parsed.error }),
    ...(parsed.code !== undefined && { code: parsed.code }),
    chunks: [],
  };
}

function parseSSE(body: string): HostObservation {
  const chunks: string[] = [];
  let output: string | undefined;
  let error: string | undefined;
  let code: string | undefined;
  for (const frame of body.split('\n\n')) {
    const name = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!name || !data) continue;
    const payload = JSON.parse(data) as { text?: string; output?: string; message?: string };
    if (name === 'chunk' && typeof payload.text === 'string') chunks.push(payload.text);
    if (name === 'complete') output = payload.output;
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
    chunks,
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

// ─── Both hosts, the same contract ───────────────────────────────────

describeHostContract(nodeSubject);
describeHostContract(inProcessSubject);

// ─── And directly against each other ─────────────────────────────────

describe('one handler, two hosts', () => {
  const cases: ContractRequest[] = [
    { input: 'hello' },
    { input: 'with a session', sessionId: 's-1' },
    { input: 'with a header', headers: { 'x-probe': 'yes' } },
  ];

  it('produces byte-identical answers on both hosts', async () => {
    for (const request of cases) {
      const overHttp = await withHost(nodeSubject, request);
      const inProcess = await withHost(inProcessSubject, request);
      expect(overHttp.output).toBe(inProcess.output);
      expect(overHttp.output).toBe(expectedOutput(request));
    }
  });

  it('reports the same failure on both hosts', async () => {
    const overHttp = await withHost(nodeSubject, { input: 'FAIL' });
    const inProcess = await withHost(inProcessSubject, { input: 'FAIL' });
    expect(overHttp.error).toBe(inProcess.error);
    expect(overHttp.output).toBeUndefined();
    expect(inProcess.output).toBeUndefined();
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
