/** Actual Anthropic SDK, with every HTTP send answered by an owned fetch fixture. */
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { anthropic } from '../../../src/providers.js';
import type { LLMProvider } from '../../../src/index.js';
import { validateToolArgs } from '../../../src/tools/toolArgsValidation.js';
import {
  QUESTION,
  TOOL,
  VM,
  bag,
  buildFixtureAgent,
  contractIn,
  flatArgs,
  nestedArgs,
  permitsNestedReply,
  type Bag,
} from '../../core/agent/arguments/sourceContractFixture.js';

function sdkResponse(content: Bag[], stream: boolean) {
  const reason = content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn';
  if (!stream)
    return new Response(
      JSON.stringify({
        id: 'synthetic-sdk-message',
        model: 'claude-sonnet-4-6',
        role: 'assistant',
        type: 'message',
        content,
        stop_reason: reason,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  const events: Bag[] = [
    {
      type: 'message_start',
      message: {
        id: 'synthetic-sdk-message',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
  ];
  content.forEach((block, index) => {
    if (block.type === 'tool_use') {
      events.push(
        {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
        },
      );
    } else
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
      );
    events.push({ type: 'content_block_stop', index });
  });
  events.push(
    {
      type: 'message_delta',
      delta: { stop_reason: reason, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  );
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function noticeFrom(body: Bag): unknown {
  for (const message of body.messages as Bag[])
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (bag(block) && block.type === 'tool_result' && block.tool_use_id === 'flat-proposal')
        return block.content;
    }
}

/** This condition reads the actual SDK JSON, not a queued successful model reply. */
function servesSourceContract(body: Bag): boolean {
  const tool = (body.tools as Bag[]).find((candidate) => candidate.name === TOOL);
  const schema = tool?.input_schema;
  if (
    !bag(schema) ||
    !Array.isArray(schema.required) ||
    !schema.required.includes('_findings') ||
    !bag(schema.properties)
  )
    return false;
  const declaration = schema.properties._findings;
  if (
    !bag(declaration) ||
    !Array.isArray(declaration.required) ||
    !declaration.required.includes('from') ||
    !declaration.required.includes('basis')
  )
    return false;
  return validateToolArgs(nestedArgs(), schema).ok && !validateToolArgs(flatArgs(), schema).ok;
}

describe('typed native correction crosses the real Anthropic SDK wire', () => {
  it.each(
    [false, true].flatMap((streaming) =>
      [false, true].map((firstContract) => ({ streaming, firstContract })),
    ),
  )(
    'keeps the serialized source contract and admission exact (stream=$streaming, first=$firstContract)',
    async ({ streaming, firstContract }) => {
      const bodies: Bag[] = [],
        ran: Bag[] = [],
        atRequest: number[] = [];
      let firstAccepted = false;
      const client = new Anthropic({
        apiKey: 'synthetic-unused-key',
        baseURL: 'https://synthetic.invalid',
        maxRetries: 0,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          expect(new URL(request.url).hostname).toBe('synthetic.invalid');
          const body = (await request.json()) as Bag;
          bodies.push(body);
          atRequest.push(ran.length);
          expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(192 * 1024);
          expect(body.max_tokens).toBe(1024);
          expect(body.model).toBe('claude-sonnet-4-6');
          expect(body.thinking).toBeUndefined();
          let content: Bag[] = [
            { type: 'text', text: 'No typed declaration contract was received.' },
          ];
          if (firstContract) {
            if (bodies.length === 1 && servesSourceContract(body)) {
              firstAccepted = true;
              content = [
                { type: 'tool_use', id: 'nested-proposal', name: TOOL, input: nestedArgs() },
              ];
            } else if (bodies.length === 2 && firstAccepted && ran.length === 1)
              content = [{ type: 'text', text: 'Finished synthetic fixture.' }];
            else if (bodies.length > 2)
              throw Error('No extra first-contract SDK send was authored.');
          } else {
            if (bodies.length === 1)
              content = [{ type: 'tool_use', id: 'flat-proposal', name: TOOL, input: flatArgs() }];
            else if (bodies.length === 2 && permitsNestedReply(contractIn(noticeFrom(body)), true))
              content = [
                { type: 'tool_use', id: 'nested-proposal', name: TOOL, input: nestedArgs() },
              ];
            else if (bodies.length === 3 && ran.length === 1)
              content = [{ type: 'text', text: 'Finished synthetic fixture.' }];
            else if (bodies.length > 3) throw Error('No extra SDK send was authored.');
          }
          return sdkResponse(content, body.stream === true);
        },
      });
      const native = anthropic({
        _client: client,
        thinkingMode: () => 'none',
        maxRetries: 0,
        defaultMaxTokens: 1024,
      });
      const provider: LLMProvider = streaming ? native : { ...native, stream: undefined };
      const agent = buildFixtureAgent(provider, ran, true);
      try {
        await agent.run({ message: QUESTION });
        console.info(
          'SOURCE_CONTRACT_SDK_WIRE',
          JSON.stringify({
            streaming,
            firstContract,
            schemaSha256: bodies.map((body) =>
              createHash('sha256')
                .update(JSON.stringify((body.tools as Bag[]).map((tool) => tool.input_schema)))
                .digest('hex'),
            ),
            maxWireBytes: Math.max(
              ...bodies.map((body) => Buffer.byteLength(JSON.stringify(body))),
            ),
            maxTokens: bodies.map((body) => body.max_tokens),
          }),
        );
        expect(ran).toEqual([{ vm: VM }]);
        expect(atRequest).toEqual(firstContract ? [0, 1] : [0, 0, 1]);
        if (!firstContract) {
          const contract = contractIn(noticeFrom(bodies[1]!));
          expect(contract).toMatchObject({
            code: 'source-declaration-required',
            path: ['_findings', 'from'],
            missingArguments: ['vm'],
          });
          expect(JSON.stringify(contract)).not.toContain(VM);
          expect(JSON.stringify(contract)).not.toContain('flat-proposal');
        }
        expect(
          new Set(
            bodies.map((body) =>
              JSON.stringify((body.tools as Bag[]).map((tool) => tool.input_schema)),
            ),
          ).size,
        ).toBe(1);
        const tool = (bodies[1]!.tools as Bag[]).find((candidate) => candidate.name === TOOL)!;
        const schema = tool.input_schema as Bag;
        expect(schema.required ?? []).toContain('_findings');
        expect(servesSourceContract(bodies[0]!)).toBe(true);
        expect((schema.properties as Bag)._findings).toBeDefined();
        expect((schema.properties as Bag).parent_findings).toBeUndefined();
        if (!firstContract) {
          const replay = (bodies[1]!.messages as Bag[])
            .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
            .find((block: Bag) => block.type === 'tool_use' && block.id === 'flat-proposal') as Bag;
          expect(replay.input).toEqual(flatArgs());
        }
      } finally {
        await agent.shutdown();
      }
    },
  );
});
