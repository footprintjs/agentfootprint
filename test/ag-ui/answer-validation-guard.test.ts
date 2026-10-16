/**
 * SCENARIO — an output guard over `streamHandler({ adapter: agUi() })`.
 *
 * The rule: "the answer presents code, but no code-execution tool ran" fails
 * the run. `answerValidation` in `mode: 'enforce'` holds the reply; the guard
 * reads which tools THIS run called from `context.toolCalls`.
 *
 * The provider really streams, token by token, and the AG-UI stream is read as
 * the bytes a browser receives, incrementally, so the order of "the guard
 * decided" and "the first answer byte left" is observed, not inferred.
 *
 *   1. A refusal: no TEXT_MESSAGE_CONTENT carries the draft, the draft's bytes
 *      never reach the wire, and the run ends in RUN_ERROR.
 *   2. A pass: the answer's content leaves only after the guard passed.
 *   3. Two requests at once: each guard reads only its own run's calls.
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, type OutputSchemaParser } from '../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../src/provider-contract/types.js';
import { streamHandler } from '../../src/hosting/streamHandler.js';
import { agUi } from '../../src/ag-ui/adapter.js';
import { AG_UI_RUN_FAILED } from '../../src/ag-ui/serializer.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';

interface Reply {
  text: string;
}
const replyParser: OutputSchemaParser<Reply> = {
  parse(value) {
    const candidate = value as Partial<Reply> | null;
    if (candidate === null || typeof candidate?.text !== 'string') throw new Error('text required');
    return { text: candidate.text };
  },
};

const DRAFT_CANARY = 'zqDRAFT-1729';
const CODE_ANSWER = JSON.stringify({
  text: `Run this:\n\`\`\`python\nprint(${DRAFT_CANARY})\n\`\`\``,
});

type Turn = { content: string; toolCalls?: LLMResponse['toolCalls'] };

/** A provider that streams each scripted turn in small chunks. */
function streaming(turns: Turn[]): LLMProvider {
  let index = 0;
  return {
    name: 'guard-stream-fixture',
    complete: async () => {
      throw new Error('the real stream path must be used');
    },
    stream: async function* () {
      const turn = turns[index++];
      if (turn === undefined) throw new Error('unexpected provider call');
      const parts = turn.content.match(/[\s\S]{1,8}/g) ?? [];
      for (const [tokenIndex, content] of parts.entries()) {
        yield { tokenIndex, content, done: false };
      }
      yield {
        tokenIndex: parts.length,
        content: '',
        done: true,
        response: {
          content: turn.content,
          toolCalls: turn.toolCalls ?? [],
          usage: { input: 2, output: 3 },
          stopReason: turn.toolCalls?.length ? 'tool_use' : 'stop',
        },
      };
    },
  };
}

const tool = (name: string) =>
  defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', properties: { source: { type: 'string' } } },
    execute: async () => `${name} done`,
  });

/** The README rule, verbatim in spirit: presented code must have run. */
function guardedAgent(turns: Turn[], order: string[], seen: string[][] = []) {
  return Agent.create({ provider: streaming(turns), model: 'm' })
    .system('Answer as JSON.')
    .tool(tool('run_code'))
    .tool(tool('search'))
    .outputSchema(replyParser)
    .answerValidation<Reply>({
      id: 'presented-code-was-executed',
      version: '1',
      mode: 'enforce',
      validate(answer, { toolCalls }) {
        order.push('guard');
        seen.push(toolCalls.calls.map((c) => `${c.name}:${c.callId}:${c.outcome}`));
        const presentsCode = answer.text.includes('```');
        const executed = toolCalls.calls.some((c) => c.name === 'run_code' && c.outcome === 'ok');
        return {
          checks: [
            {
              id: 'code-ran',
              disposition: !presentsCode
                ? 'not-applicable'
                : executed
                ? 'checked-pass'
                : toolCalls.complete
                ? 'checked-fail'
                : 'unreachable',
            },
            { id: 'answered', disposition: 'checked-pass' },
          ],
        };
      },
    })
    .build();
}

const request = (runId: string, user = 'alice') =>
  new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user': user },
    body: JSON.stringify({
      threadId: `thread-${runId}`,
      runId,
      messages: [{ id: 'u1', role: 'user', content: 'Add two and two.' }],
      tools: [],
      context: [],
    }),
  });

/** Read the SSE body as it arrives, noting each event into `order` as it lands. */
async function readLive(
  response: Response,
  order: string[],
): Promise<{ wire: string; events: AgUiEvent[] }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let wire = '';
  let pending = '';
  const events: AgUiEvent[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    wire += chunk;
    pending += chunk;
    let cut: number;
    while ((cut = pending.indexOf('\n\n')) !== -1) {
      const frame = pending.slice(0, cut);
      pending = pending.slice(cut + 2);
      if (!frame.startsWith('data: ')) continue;
      const event = JSON.parse(frame.slice('data: '.length)) as AgUiEvent;
      events.push(event);
      order.push(event.type);
    }
  }
  return { wire, events };
}

const handlerFor = (agent: (runId: string) => Agent) =>
  streamHandler({
    agent: ({ thread }) => agent(String(thread?.identity?.conversationId ?? '')),
    adapter: agUi(),
    threads: {
      bind: ({ conversation, headers }) => ({
        sessionId: `${headers['x-user']}:${conversation}`,
        identity: { principal: String(headers['x-user']), conversationId: conversation },
      }),
    },
    heartbeatMs: 0,
  });

describe('scenario — the output guard holds the reply over streamHandler + agUi()', () => {
  it('a refusal: no answer content leaves, the draft never reaches the wire, the run ends in RUN_ERROR', async () => {
    const order: string[] = [];
    const seen: string[][] = [];
    const handle = handlerFor(() =>
      guardedAgent(
        [
          { content: '', toolCalls: [{ id: 'call_s', name: 'search', args: { source: 'q' } }] },
          { content: CODE_ANSWER },
        ],
        order,
        seen,
      ),
    );
    const { wire, events } = await readLive(await handle(request('refused')), order);

    expect(seen).toEqual([['search:call_s:ok']]);
    expect(events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')).toEqual([]);
    expect(wire).not.toContain(DRAFT_CANARY);
    expect(wire).not.toContain('```');
    // Fixed words: the refusal's report (check ids, reasons) stays server-side.
    expect(events.at(-1)).toEqual({ type: 'RUN_ERROR', message: AG_UI_RUN_FAILED });
    expect(events.some((e) => e.type === 'RUN_FINISHED')).toBe(false);
    // The guard ran before the run ended.
    expect(order.indexOf('guard')).toBeLessThan(order.indexOf('RUN_ERROR'));
  });

  it('a pass: the answer content leaves only after the guard passed', async () => {
    const order: string[] = [];
    const seen: string[][] = [];
    const handle = handlerFor(() =>
      guardedAgent(
        [
          { content: '', toolCalls: [{ id: 'call_r', name: 'run_code', args: { source: 'x' } }] },
          { content: CODE_ANSWER },
        ],
        order,
        seen,
      ),
    );
    const { events } = await readLive(await handle(request('passed')), order);

    expect(seen).toEqual([['run_code:call_r:ok']]);
    const content = events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT');
    expect(content.length).toBeGreaterThan(0);
    const delivered = content.map((e) => (e as { delta: string }).delta).join('');
    expect(delivered).toBe(CODE_ANSWER);
    expect(order.indexOf('guard')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('guard')).toBeLessThan(order.indexOf('TEXT_MESSAGE_CONTENT'));
    expect(events.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
  });

  it('two requests at once: each guard reads only its own run’s calls', async () => {
    let arrived = 0;
    let open!: () => void;
    const both = new Promise<void>((resolve) => (open = resolve));
    const meeting = (name: string) =>
      defineTool({
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          arrived += 1;
          if (arrived === 2) open();
          await both;
          return 'ok';
        },
      });
    const seen = new Map<string, string[]>();
    const handle = handlerFor((runId) =>
      Agent.create({
        provider: streaming([
          { content: '', toolCalls: [{ id: `id_${runId}`, name: `tool_${runId}`, args: {} }] },
          { content: JSON.stringify({ text: `done ${runId}` }) },
        ]),
        model: 'm',
      })
        .tool(meeting(`tool_${runId}`))
        .outputSchema(replyParser)
        .answerValidation<Reply>({
          id: 'own-calls',
          version: '1',
          validate(_answer, { toolCalls }) {
            seen.set(
              runId,
              toolCalls.calls.map((c) => `${c.name}:${c.callId}`),
            );
            return { checks: [{ id: 'seen', disposition: 'checked-pass' }] };
          },
        })
        .build(),
    );
    const [a, b] = await Promise.all([
      handle(request('one', 'alice')),
      handle(request('two', 'bob')),
    ]);
    await Promise.all([readLive(a, []), readLive(b, [])]);
    expect(arrived).toBe(2);
    expect(seen.get('thread-one')).toEqual(['tool_thread-one:id_thread-one']);
    expect(seen.get('thread-two')).toEqual(['tool_thread-two:id_thread-two']);
  });
});
