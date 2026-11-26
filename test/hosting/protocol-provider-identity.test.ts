import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { agUi } from '../../src/ag-ui/adapter.js';
import { agUiSerializer } from '../../src/ag-ui/serializer.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';
import { httpHost, type HttpWire } from '../../src/hosting/httpHost.js';
import { protocolRoute } from '../../src/hosting/protocolRoute.js';
import { failedSettlement } from '../../src/hosting/failedSettlement.js';
import { VerifierUnavailableError } from '../../src/hosting/errors.js';
import type { HostHandler } from '../../src/hosting/types.js';
import {
  ProviderBlockedError,
  ProviderGuardrailLimitError,
  ProviderInterventionUnknownError,
} from '../../src/provider-contract/intervention.js';

const wire: HttpWire = {
  readRequest: () => ({ input: 'hello' }),
  health: () => ({}),
  output: (output) => ({ output }),
  chunk: (text) => ({ text }),
  failure: (error, code) => ({ error, code }),
};
const requestBody = {
  threadId: 'thread',
  runId: 'run',
  messages: [{ id: 'user', role: 'user', content: 'hello' }],
  tools: [],
  context: [],
};
const adapter = () =>
  agUi({
    framing: {
      contentType: 'text/event-stream',
      frame: (event) => `data: ${JSON.stringify(event)}\n\n`,
    },
  });

/** Exercise the real HTTP dispatch and failure handoff without creating a socket. */
async function standing(
  handler: HostHandler,
  limits: { maxEventBytes?: number } = {},
  path = '/ag-ui',
): Promise<{ events: AgUiEvent[]; text: string }> {
  const server = Object.assign(new EventEmitter(), {
    listening: true,
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 8080 }),
  });
  const host = httpHost({
    name: 'protocol-provider-identity',
    wire,
    invokePath: '/invoke',
    healthPath: '/health',
    server: server as unknown as Server,
    allowedHosts: ['localhost'],
    protocols: [protocolRoute({ path: '/ag-ui', adapter: adapter(), ...limits })],
  });
  const handle = await host.serve(handler);
  const pieces: string[] = [];
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => (finish = resolve));
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    writeHead() {
      this.headersSent = true;
    },
    write(text: string) {
      pieces.push(text);
      return true;
    },
    end(text?: string) {
      if (text !== undefined) pieces.push(text);
      this.writableEnded = true;
      finish();
    },
  });
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(requestBody))]), {
    method: 'POST',
    url: path,
    headers: { host: 'localhost', 'content-type': 'application/json', accept: 'text/event-stream' },
  });
  try {
    server.emit('request', request, response);
    await ended;
    const text = pieces.join('');
    return {
      text,
      events: text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)) as AgUiEvent)
        .filter((event) => event.type !== 'RUN_STARTED'),
    };
  } finally {
    await handle.close();
    expect(server.listenerCount('request')).toBe(0);
  }
}

function direct(error: Error): readonly AgUiEvent[] {
  return agUiSerializer({ threadId: 'thread', runId: 'run' })
    .settle(failedSettlement(error))
    .filter((event) => event.type !== 'RUN_STARTED');
}

const refusals = [
  {
    error: new ProviderBlockedError({ outcome: 'blocked', code: 'owned', filters: [] }),
    message: 'The provider blocked this response.',
  },
  {
    error: new ProviderInterventionUnknownError({ outcome: 'unknown', code: 'owned', filters: [] }),
    message: 'The provider intervention outcome is unknown.',
  },
  {
    error: new ProviderGuardrailLimitError(),
    message: 'The guarded response exceeded its configured private buffer limit.',
  },
] as const;

describe('standing provider refusal identity', () => {
  for (const { error: typed, message } of refusals) {
    for (const terminal of ['throw', 'fail'] as const) {
      it(`${terminal}: an ordinary Error claiming ${typed.code} stays generic at both boundaries`, async () => {
        const error = Object.assign(new Error('PRIVATE_APPLICATION_FAILURE'), { code: typed.code });
        const expected = direct(error);
        expect(expected).toEqual([{ type: 'RUN_ERROR', message: 'The run failed.' }]);
        const result = await standing((_request, reply) => {
          if (terminal === 'throw') throw error;
          reply.fail(error);
        });
        expect(result.events).toEqual(expected);
        expect(result.text).not.toContain('PRIVATE_APPLICATION_FAILURE');
        expect(result.text).not.toContain(typed.code);
      });

      it(`${terminal}: actual ${typed.name} keeps its proved refusal`, async () => {
        const expected = direct(typed);
        expect(expected).toEqual([{ type: 'RUN_ERROR', code: typed.code, message }]);
        const result = await standing((_request, reply) => {
          if (terminal === 'throw') throw typed;
          reply.fail(typed);
        });
        expect(result.events).toEqual(expected);
      });
    }

    it(`a standalone string-only framing failure cannot prove ${typed.code}`, () => {
      const route = protocolRoute({ path: '/ag-ui', adapter: adapter() });
      const facts = { body: requestBody, headers: {}, query: new URLSearchParams() };
      route.wire.readRequest(facts);
      const frames = route.wire.stream!(facts).failure('PRIVATE_APPLICATION_FAILURE', typed.code);
      expect(
        frames
          .map((frame) => frame.data as AgUiEvent)
          .filter((event) => event.type !== 'RUN_STARTED'),
      ).toEqual([{ type: 'RUN_ERROR', message: 'The run failed.' }]);
    });
  }

  it('preserves an ordinary generic failure', async () => {
    const error = new Error('PRIVATE_ORDINARY_FAILURE');
    const result = await standing(() => {
      throw error;
    });
    expect(result.events).toEqual(direct(error));
    expect(result.text).not.toContain('PRIVATE_ORDINARY_FAILURE');
  });

  it('keeps the incumbent wire failure message and code unchanged', async () => {
    const error = Object.assign(new Error('LEGACY_WORDS'), { code: 'ERR_PROVIDER_BLOCKED' });
    const result = await standing((_request, reply) => reply.fail(error), {}, '/invoke');
    expect(result.text).toBe(
      'event: error\ndata: {"error":"LEGACY_WORDS","code":"ERR_PROVIDER_BLOCKED"}\n\n',
    );
  });

  it('preserves the existing closed host refusal', async () => {
    const result = await standing((_request, reply) =>
      reply.fail(new VerifierUnavailableError('private-verifier', 'PRIVATE_CONNECTION')),
    );
    expect(result.events).toEqual([
      {
        type: 'RUN_ERROR',
        code: 'ERR_IDENTITY_VERIFIER_UNAVAILABLE',
        message: 'Identity verification is unavailable. Try again when the service is reachable.',
      },
    ]);
  });

  it('preserves a stream-budget refusal before publishing the candidate terminal', async () => {
    const result = await standing((_request, reply) => reply.complete('x'.repeat(512)), {
      maxEventBytes: 128,
    });
    expect(result.events).toEqual([
      {
        type: 'RUN_ERROR',
        code: 'ERR_STREAM_LIMIT',
        message: 'The stream exceeded its configured delivery limit.',
      },
    ]);
  });

  for (const outcome of ['ordinary', 'masked'] as const) {
    it(`${outcome} response keeps the authorized completion`, async () => {
      const result = await standing(async (_request, reply) => {
        const runner = Agent.create({
          model: 'scripted',
          provider: {
            name: 'scripted',
            complete: async () => ({
              content: 'Safe answer',
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'end_turn',
              ...(outcome === 'masked' && {
                intervention: { outcome: 'masked', code: 'owned', filters: [] },
              }),
            }),
          },
        }).build();
        runner.on('*', (event) => reply.event?.(event));
        const output = await runner.run({ message: 'hello' });
        expect(typeof output).toBe('string');
        reply.complete(output as string);
      });
      expect(result.events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toEqual([
        expect.objectContaining({ delta: 'Safe answer' }),
      ]);
      expect(result.events.at(-1)).toEqual({
        type: 'RUN_FINISHED',
        threadId: 'thread',
        runId: 'run',
        result: 'Safe answer',
      });
      expect(result.events.some((event) => event.type === 'RUN_ERROR')).toBe(false);
    });
  }
});
