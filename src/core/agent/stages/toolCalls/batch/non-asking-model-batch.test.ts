import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../../index.js';
import type { LLMRequest, LLMResponse } from '../../../../../provider-contract/types.js';

const call = (id: unknown, name: unknown = 'collect') => ({ id, name, args: { year: 2026 } });
const unsourced = 'a value a call ran with came from the model, with no source on the record';
const refused = 'a call was refused';
const incomplete = 'a call did not complete';
const missingEntry = 'the record could not establish tool entry for every checked call';
const cases = [
  ['duplicate', [call('same'), call('same')], 2, '', unsourced],
  ['empty id', [call('')], 1, '', unsourced],
  ['numeric id', [call(7)], 1, '', unsourced],
  ['long id', [call('x'.repeat(1025))], 1, '', unsourced],
  [
    'large batch',
    Array.from({ length: 1025 }, (_, index) => call(String(index))),
    1025,
    missingEntry,
    `${unsourced}; ${missingEntry}`,
  ],
  [
    'unknown name',
    [call('bad', 'x'.repeat(1025)), call('good')],
    1,
    refused,
    `${unsourced}; ${refused}`,
  ],
  ['empty name', [call('bad', '')], 0, incomplete, incomplete],
  ['null name', [call('bad', null)], 0, incomplete, incomplete],
] as const;

for (const armed of [false, true]) {
  it.each(cases)(
    `a non-asking %s batch keeps ordinary dispatch when inputs=${armed}`,
    async (_shape, calls, expected, unruledWarning, ruledWarning) => {
      const requests: LLMRequest[] = [];
      let ran = 0;
      const builder = Agent.create({
        provider: {
          name: 'scripted',
          complete: async (request: LLMRequest): Promise<LLMResponse> => {
            requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
            return requests.length === 1
              ? { content: '', toolCalls: calls as never, usage: { input: 1, output: 1 } }
              : { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
          },
        },
        model: 'mock',
      }).tool(
        defineTool({
          name: 'collect',
          description: 'Collect',
          inputSchema: { type: 'object', properties: { year: { type: 'number' } } },
          ...(armed && { askOrAssume: { year: { ask: 'Which year?' } } }),
          execute: () => {
            ran++;
            return 'called';
          },
        }),
      );
      const agent = builder.build();
      const warning = armed ? ruledWarning : unruledWarning;
      await expect(agent.run('go')).resolves.toBe(
        warning === '' ? 'done' : `done\n\n---\n\nNot sure — ${warning}.`,
      );
      expect(ran).toBe(expected);
      expect(JSON.stringify(requests[1]!.messages)).not.toContain('Tool batch refusal');
      expect(requests[1]!.messages.filter((message) => message.role === 'tool')).toHaveLength(
        calls.length,
      );
    },
  );
}
