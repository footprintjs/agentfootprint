/** Real native dispatch over synthetic tool results; no live model or network. */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  absent,
  coverage,
  defineTool,
  inMemoryArtifacts,
  isInputPause,
  requestInput,
  semantic,
  withDatasetArtifacts,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const absence = () =>
  absent({
    what: 'item requested',
    checked: ['one synthetic snapshot'],
    notChecked: ['live state'],
    tryInstead: 'Choose another snapshot.',
  });
const call = { toolCalls: [{ id: 'lookup-call', name: 'lookup', args: {} }] };

describe('native dataset projection declarations', () => {
  it.each([false, true])(
    'preserved absence retains native status and coverage (wrapped=%s)',
    async (wrapped) => {
      const original = wrapped
        ? coverage(absence(), {
            checked: ['selected source'],
            cannotCover: [{ what: 'future state', why: 'not observed' }],
          })
        : absence();
      const ends: any[] = [],
        declarations: any[] = [];
      const tool = defineTool({
        name: 'lookup',
        description: 'Synthetic lookup',
        inputSchema: { type: 'object' },
        execute: () => original,
      });
      const agent = Agent.create({
        model: 'mock',
        artifacts: inMemoryArtifacts(),
        provider: mock({ replies: [call, 'No matching item in the checked snapshot.'] }),
      })
        .tool(
          withDatasetArtifacts(tool, {
            describe: () => ({ datasets: [], project: () => structuredClone(original) }),
          }),
        )
        .limitsTravelWithTheAnswer()
        .build();
      agent.on('agentfootprint.stream.tool_end', (event) => ends.push(event.payload));
      agent.on('agentfootprint.tools.coverage_declared', (event) =>
        declarations.push(event.payload),
      );
      agent.on('agentfootprint.tools.absent', (event) => declarations.push(event.payload));
      const output = await agent.run({
        message: 'Find the item.',
        identity: { principal: 'alice', conversationId: 'absence' },
      });
      expect(ends).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toolCallId: 'lookup-call', status: 'absent' }),
        ]),
      );
      expect(ends.some((end) => end.error === true)).toBe(false);
      expect(JSON.stringify(declarations)).toContain('live state');
      expect(String(output)).toContain('live state');
      if (wrapped) expect(String(output)).toContain('future state');
    },
  );

  it.each([
    ['absence', absence],
    ['clarify', () => semantic({ clarify: { question: 'Which source?', candidates: ['A', 'B'] } })],
    [
      'explicit failure',
      () => ({ content: { reason: 'unavailable' }, effects: [], status: 'failure' }),
    ],
  ] as const)(
    'erased %s becomes a tool failure, never a successful dataset result',
    async (_, source) => {
      const ends: any[] = [];
      let resultText = '';
      const tool = defineTool({
        name: 'lookup',
        description: 'Synthetic lookup',
        inputSchema: { type: 'object' },
        execute: source,
      });
      let calls = 0;
      const agent = Agent.create({
        model: 'mock',
        artifacts: inMemoryArtifacts(),
        provider: mock({
          respond(request) {
            if (++calls === 1) return call;
            resultText = [...request.messages]
              .reverse()
              .find((message) => message.role === 'tool')!.content;
            return 'The projection failed.';
          },
        }),
      })
        .tool(
          withDatasetArtifacts(tool, {
            describe: () => ({ datasets: [], project: () => ({ dataset: 'FALSE_SUCCESS' }) }),
          }),
        )
        .build();
      agent.on('agentfootprint.stream.tool_end', (event) => ends.push(event.payload));
      await agent.run({ message: 'Find the item.' });
      expect(resultText).toMatch(/projection.*declaration/i);
      expect(resultText).not.toContain('FALSE_SUCCESS');
      expect(ends).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toolCallId: 'lookup-call', error: true }),
        ]),
      );
    },
  );

  it('passes requestInput through before adapter or store publication', async () => {
    const describe = vi.fn();
    const store = inMemoryArtifacts(),
      put = vi.spyOn(store, 'put');
    const tool = defineTool({
      name: 'lookup',
      description: 'Collect missing input',
      inputSchema: { type: 'object' },
      execute: () =>
        requestInput({
          id: 'source',
          question: 'Which source?',
          fields: [{ id: 'source', type: 'string', required: true }],
        }),
    });
    const agent = Agent.create({
      model: 'mock',
      artifacts: store,
      provider: mock({ replies: [call] }),
    })
      .tool(withDatasetArtifacts(tool, { describe }))
      .build();
    const output = await agent.run({ message: 'Find the item.' });
    expect(isInputPause(output)).toBe(true);
    expect(describe).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
