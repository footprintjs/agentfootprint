/**
 * A withheld answer over the hosting doors — `standingAgent` on a real
 * `nodeHost` socket, an agent with an ENFORCING `.answerValidation()`.
 *
 * The bug this pins: `ERR_ANSWER_VALIDATION` had no row in
 * `hosting/refusalStatus.ts`, so a person whose answer the app's checks
 * withheld received a 500 — the status for "the agent broke". Nothing broke:
 * the request was fine and the agent ran; the answer it produced did not pass
 * the app's checks. Now:
 *   - the JSON door answers 422 with the refusal's own code and words;
 *   - the stream door (SSE, already 200 by then) ends in one `error` frame
 *     carrying the same code and words;
 *   - neither door ever carries a byte of the withheld draft.
 * Tools the turn already called have run: withholding the answer does not
 * undo them (pinned below, so the docs' sentence stays true).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { Agent, defineTool, type OutputSchemaParser } from '../../src/index.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/hosting/index.js';
import type { HostHandle } from '../../src/hosting/index.js';
import { REFUSAL_STATUS } from '../../src/hosting/refusalStatus.js';

const DRAFT_CANARY = 'ORD-99812';

interface OrderAnswer {
  readonly order: string;
}
const orderAnswer: OutputSchemaParser<OrderAnswer> = {
  parse(value) {
    const c = value as Partial<OrderAnswer> | null;
    if (typeof c?.order !== 'string') throw new Error('order is required');
    return { order: c.order };
  },
};

type Turn = {
  readonly content?: string;
  readonly toolCalls?: readonly { id: string; name: string; args: Record<string, unknown> }[];
};

/** A provider that really streams each turn, in two chunks. */
function streaming(turns: readonly Turn[]): LLMProvider {
  let index = 0;
  return {
    name: 'refusal-door-fixture',
    complete: async () => {
      throw new Error('the stream path must be used');
    },
    stream: async function* () {
      const turn = turns[index++];
      if (turn === undefined) throw new Error('unexpected provider call');
      const content = turn.content ?? '';
      const at = Math.ceil(content.length / 2);
      if (content.length > 0) {
        yield { tokenIndex: 0, content: content.slice(0, at), done: false };
        yield { tokenIndex: 1, content: content.slice(at), done: false };
      }
      const toolCalls = [...(turn.toolCalls ?? [])];
      yield {
        tokenIndex: 2,
        content: '',
        done: true,
        response: {
          content,
          toolCalls,
          usage: { input: 1, output: 1 },
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
        },
      };
    },
  };
}

const open: HostHandle[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((handle) => handle.close()));
});

/** An agent whose tool records each run, and whose check refuses the order it names. */
async function door() {
  const ran: string[] = [];
  const agent = () =>
    Agent.create({
      provider: streaming([
        { toolCalls: [{ id: 'call-1', name: 'cancel_order', args: {} }] },
        { content: JSON.stringify({ order: DRAFT_CANARY }) },
      ]),
      model: 'synthetic',
      maxIterations: 4,
    })
      .tool(
        defineTool({
          name: 'cancel_order',
          description: 'Cancel the order.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => {
            ran.push('cancel_order');
            return 'cancelled';
          },
        }),
      )
      .outputSchema(orderAnswer)
      .answerValidation<OrderAnswer>({
        id: 'asked-order',
        version: '1',
        validate: () => ({ checks: [{ id: 'asked-order', disposition: 'checked-fail' }] }),
      })
      .build();
  const handle = await standingAgent({
    agentFactory: agent,
    sessions: memorySessions(),
    host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
  });
  open.push(handle);
  return { handle, ran };
}

const post = (url: string, headers: Record<string, string> = {}) =>
  fetch(`${url}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ input: 'Cancel my last order.' }),
  });

describe('a withheld answer is a refusal, never a 5xx', () => {
  it('the table maps it to 422', () => {
    expect(REFUSAL_STATUS.ERR_ANSWER_VALIDATION).toBe(422);
  });

  it('JSON door: 422, the refusal code and its words — no draft', async () => {
    const { handle, ran } = await door();
    const reply = await post(handle.url);
    expect(reply.status).toBe(422);
    const text = await reply.text();
    expect(JSON.parse(text)).toEqual({
      error: "The answer was withheld: answer validation 'asked-order' did not pass (failed).",
      code: 'ERR_ANSWER_VALIDATION',
    });
    expect(text).not.toContain(DRAFT_CANARY);
    // The refusal withholds the answer; it does not undo the tool that ran.
    expect(ran).toEqual(['cancel_order']);
  });

  it('stream door: one error frame with the same code and words — no draft chunk', async () => {
    const { handle } = await door();
    const reply = await post(handle.url, { accept: 'text/event-stream' });
    expect(reply.status).toBe(200); // the stream had started; the refusal is its last frame
    const body = await reply.text();
    expect(body).not.toContain(DRAFT_CANARY);
    expect(body).not.toContain('event: complete');
    expect(body).toContain('event: error');
    expect(body).toContain('"code":"ERR_ANSWER_VALIDATION"');
    expect(body).toContain("answer validation 'asked-order' did not pass (failed)");
  });
});
