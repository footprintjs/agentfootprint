/** Real adapters with injected local transports; these tests measure placement, not cache savings. */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { anthropic, bedrock } from '../../src/doors/providers.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { findingsPrefix } from '../helpers/findingsData.js';

type Body = Record<string, any>;
const stand = {
  basis: 'direct',
  previous: [
    {
      toolCallId: 'c1',
      standing: 'fact',
      assertions: [
        { subject: { kind: 'fixture', id: 'one' }, predicate: 'value', value: 'synthetic-value' },
      ],
    },
  ],
};
class Command {
  constructor(readonly input: Body) {}
}
function fixture(vendor: 'anthropic' | 'bedrock') {
  const bodies: Body[] = [];
  let call = 0;
  const reply = (body: Body) => {
    bodies.push(JSON.parse(JSON.stringify(body)));
    call++;
    return call < 3 ? { id: `c${call}`, args: call === 2 ? { _findings: stand } : {} } : undefined;
  };
  const provider: LLMProvider =
    vendor === 'anthropic'
      ? anthropic({
          _client: {
            messages: {
              create: async (body: Body) => {
                const turn = reply(body);
                return {
                  id: `message-${call}`,
                  type: 'message',
                  role: 'assistant',
                  model: 'claude-haiku-4-5',
                  stop_reason: turn ? 'tool_use' : 'end_turn',
                  usage: { input_tokens: 1, output_tokens: 1 },
                  content: turn
                    ? [{ type: 'tool_use', id: turn.id, name: 'lookup', input: turn.args }]
                    : [{ type: 'text', text: 'done' }],
                };
              },
            },
          } as never,
        })
      : bedrock({
          _commands: { Converse: Command as never, ConverseStream: Command as never },
          _client: {
            send: async (command) => {
              const turn = reply((command as Command).input);
              return {
                output: {
                  message: {
                    role: 'assistant',
                    content: turn
                      ? [{ toolUse: { toolUseId: turn.id, name: 'lookup', input: turn.args } }]
                      : [{ text: 'done' }],
                  },
                },
                stopReason: turn ? 'tool_use' : 'end_turn',
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            },
          },
        });
  return {
    bodies,
    provider,
    model:
      vendor === 'anthropic' ? 'claude-haiku-4-5' : 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  };
}

function messageBlocks(body: Body) {
  return body.messages.flatMap((message: Body) =>
    typeof message.content === 'string' ? [{ text: message.content }] : message.content,
  );
}
describe('findings late DATA through real vendor wires', () => {
  for (const vendor of ['anthropic', 'bedrock'] as const) {
    it(`${vendor}: tools and system repeat, and all cache marks precede mutable DATA`, async () => {
      const f = fixture(vendor);
      const agent = Agent.create({
        provider: { ...f.provider, stream: undefined },
        model: f.model,
        maxIterations: 5,
      })
        .system('Stable synthetic instructions. '.repeat(120))
        .tool(
          defineTool({
            name: 'lookup',
            description: 'Read a synthetic value.',
            inputSchema: { type: 'object', properties: {} },
            execute: () => 'synthetic-value',
          }),
        )
        .findings()
        .build();
      await agent.run({ message: 'Inspect the synthetic fixture.' });
      expect(f.bodies).toHaveLength(3);
      const tools = (body: Body) => (vendor === 'anthropic' ? body.tools : body.toolConfig);
      expect(f.bodies.map((body) => JSON.stringify(tools(body)))).toEqual(
        Array(3).fill(JSON.stringify(tools(f.bodies[0]!))),
      );
      expect(f.bodies.map((body) => JSON.stringify(body.system))).toEqual(
        Array(3).fill(JSON.stringify(f.bodies[0]!.system)),
      );
      const second = f.bodies[1]!;
      const blocks = messageBlocks(second);
      const tail = blocks.findIndex(
        (block: Body) => typeof block.text === 'string' && block.text.startsWith(findingsPrefix),
      );
      expect(tail).toBeGreaterThan(0);
      const marks = blocks.flatMap((block: Body, index: number) =>
        (vendor === 'anthropic' ? block.cache_control : block.cachePoint) ? [index] : [],
      );
      expect(marks.length).toBeGreaterThan(0);
      for (const index of marks) expect(index).toBeLessThan(tail);
      const data = blocks[tail]!;
      expect(data.cache_control).toBeUndefined();
      expect(data.cachePoint).toBeUndefined();
      expect(JSON.stringify(f.bodies[2]!.system)).not.toContain('synthetic-value');
      expect(
        messageBlocks(f.bodies[2]!).some(
          (block: Body) =>
            typeof block.text === 'string' &&
            block.text.startsWith(findingsPrefix) &&
            block.text.includes('synthetic-value'),
        ),
      ).toBe(true);
    });
  }
});
