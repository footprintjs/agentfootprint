import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../../index.js';
import type { LLMRequest, LLMResponse } from '../../../../../provider-contract/types.js';
import { isSaidByPerson } from '../../../../../lib/saidByPerson.js';
import { toAnthropicMessages } from '../../../../../adapters/llm/anthropicMessageProjection.js';
import { isLibraryAuthoredTurn } from '../../../evidence/frames.js';
import { bedrock } from '../../../../../adapters/llm/BedrockProvider.js';

const call = (id: string, name = 'collect') => ({ id, name, args: {} });
for (const [shape, calls] of [
  ['duplicate', [call('same'), call('same')]],
  ['long-name', [call('first'), call('second', 'x'.repeat(1025))]],
  ['too-many', Array.from({ length: 1025 }, (_, i) => call(String(i)))],
  ['empty-id', [call('')]],
  ['numeric-id', [{ ...call('numeric'), id: 7 }]],
  ['long-id', [call('x'.repeat(1025))]],
] as const) {
  it(`refuses the ${shape} model batch before an ask or tool effect and accepts a corrective response`, async () => {
    const requests: LLMRequest[] = [];
    let ran = 0;
    const agent = Agent.create({
      provider: {
        name: 'scripted',
        complete: async (request: LLMRequest): Promise<LLMResponse> => {
          requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
          return requests.length === 1
            ? { content: '', toolCalls: calls as never, usage: { input: 1, output: 1 } }
            : { content: 'corrected', toolCalls: [], usage: { input: 1, output: 1 } };
        },
      },
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'collect',
          description: 'Collect',
          inputSchema: { type: 'object', properties: { year: { type: 'number' } } },
          askOrAssume: { year: { ask: 'Which year?' } },
          execute: () => {
            ran++;
            return 'called';
          },
        }),
      )
      .build();
    const starts: unknown[] = [];
    agent.on('agentfootprint.stream.tool_start', (e) => starts.push(e));
    const outcome = await agent.run('go').then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    expect(outcome).toEqual({ value: 'corrected' });
    expect(ran).toBe(0);
    expect(starts).toEqual([]);
    expect(requests).toHaveLength(2);
    const messages = requests[1]!.messages;
    expect(messages.some((m) => (m.toolCalls?.length ?? 0) > 0 || m.role === 'tool')).toBe(false);
    const refusal = messages.find((m) => m.content.startsWith('[Tool batch refusal'));
    expect(refusal).toBeDefined();
    expect(isSaidByPerson(refusal!)).toBe(false);
    expect(isLibraryAuthoredTurn(refusal!.content)).toBe(true);
    const wire = JSON.stringify(toAnthropicMessages(messages));
    expect(wire).toContain('Tool batch refusal');
    expect(wire).not.toContain('tool_use');
    expect(wire).not.toContain('tool_result');
    const sent: { role: string; content: unknown[] }[][] = [];
    class Command {
      constructor(readonly input: { messages: { role: string; content: unknown[] }[] }) {}
    }
    const provider = bedrock({
      _commands: { Converse: Command, ConverseStream: Command },
      _client: {
        send: async (command: unknown) => {
          sent.push((command as Command).input.messages);
          return { output: { message: { role: 'assistant', content: [{ text: 'corrected' }] } } };
        },
      },
    });
    await provider.complete({ model: 'mock', messages });
    expect(sent).toHaveLength(1);
    expect(
      sent[0]!.some(
        (message, index, all) =>
          index > 0 && message.role === 'user' && all[index - 1]!.role === 'user',
      ),
    ).toBe(false);
    expect(JSON.stringify(sent)).not.toContain('toolUse');
    expect(JSON.stringify(sent)).not.toContain('toolResult');
    expect(JSON.stringify(agent.getLastSnapshot())).toContain('llmLatestToolCalls');
  });
}
