import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';
import { isSaidByPerson } from '../../../src/lib/saidByPerson.js';
import { toAnthropicMessages } from '../../../src/adapters/llm/anthropicMessageProjection.js';
import { isLibraryAuthoredTurn } from '../../../src/core/agent/evidence/frames.js';

const call = (id: string, name = 'collect') => ({ id, name, args: {} });
for (const [shape, calls] of [
  ['duplicate', [call('same'), call('same')]],
  ['long-name', [call('first'), call('second', 'x'.repeat(1025))]],
  ['too-many', Array.from({ length: 1025 }, (_, i) => call(String(i)))],
  ['empty-id', [call('')]],
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
            ? { content: '', toolCalls: calls, usage: { input: 1, output: 1 } }
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
    await expect(agent.run('go')).resolves.toBe('corrected');
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
    expect(JSON.stringify(agent.getLastSnapshot())).toContain('llmLatestToolCalls');
  });
}
