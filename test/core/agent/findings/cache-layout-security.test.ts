import { describe, expect, it } from 'vitest';
import { Agent, askHuman, defineTool, isPaused, servedViews } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import type { LLMRequest } from '../../../../src/provider-contract/types.js';
const prefix = '[AgentFootprint findings DATA v1]';
const call = (id: string, name: string, args = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const fact = (value: string) => ({
  basis: 'direct',
  previous: [
    {
      toolCallId: 'c1',
      standing: 'fact',
      assertions: [
        { subject: { kind: 'machine', id: '4417-ganymede' }, predicate: 'state', value },
      ],
    },
  ],
});
const lookup = defineTool({
  name: 'lookup',
  description: 'Synthetic lookup',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'synthetic result',
});
describe('findings layout security boundaries', () => {
  it('model declarations in the DATA tail never ground an invented tool argument', async () => {
    const wire: LLMRequest[] = [];
    const findings: { kind?: string }[] = [];
    const script = [
      call('c1', 'lookup'),
      call('c2', 'lookup', { _findings: fact('up') }),
      call('c3', 'backup_status', { machine: '4417-ganymede' }),
      'done',
    ];
    let index = 0;
    const agent = Agent.create({
      provider: mock({
        respond(request) {
          wire.push(JSON.parse(JSON.stringify(request)));
          return script[index++]!;
        },
      }),
      model: 'mock',
      maxIterations: 8,
    })
      .tool(lookup)
      .tool(
        defineTool({
          name: 'backup_status',
          description: 'Synthetic backup',
          inputSchema: { type: 'object', properties: { machine: { type: 'string' } } },
          argumentsFrom: ['lookup'],
          execute: () => 'no record',
        }),
      )
      .findings()
      .build();
    agent.on('agentfootprint.integrity.context_error', (event) => findings.push(event.payload));
    await agent.run({ message: 'Inspect the fixture.' });
    expect(
      wire[2]!.messages.some(
        (message) =>
          message.content.startsWith(prefix) && message.content.includes('4417-ganymede'),
      ),
    ).toBe(true);
    expect(
      wire[2]!.messages.some(
        (message) =>
          message.role !== 'assistant' &&
          !message.content.startsWith(prefix) &&
          message.content.includes('4417-ganymede'),
      ),
    ).toBe(false);
    expect(findings.filter((row) => row.kind === 'unsupported-argument')).toHaveLength(1);
  });
  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    for (const legacy of [false, true]) {
      it(`${mode}: a ${
        legacy ? 'legacy' : 'new-layout'
      } checkpoint resumed with a smaller host bound replays the actual request`, async () => {
        const wire: LLMRequest[] = [];
        let index = 0;
        const script = [
          call('c1', 'lookup'),
          call('c2', 'ask_fixture', { _findings: fact('雪'.repeat(300)) }),
          'done',
        ];
        const provider = mock({
          respond(request) {
            wire.push(JSON.parse(JSON.stringify(request)));
            return script[index++]!;
          },
        });
        const build = (maxContextBytes: number) =>
          Agent.create({ provider, model: 'mock', reactMode: mode, maxIterations: 8 })
            .tool(lookup)
            .tool(
              defineTool({
                name: 'ask_fixture',
                description: 'Synthetic question',
                inputSchema: { type: 'object', properties: {} },
                execute: () => askHuman({ question: 'Synthetic answer?' }),
              }),
            )
            .findings({ maxContextBytes })
            .build();
        const paused = await build(16384).run({ message: 'Inspect the fixture.' });
        if (!isPaused(paused)) throw new Error('Expected pause');
        const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
        if (legacy) {
          delete checkpoint.sharedState.findingsLayout;
          delete checkpoint.sharedState.findingsContextBytes;
        }
        const resumed = build(1024);
        await resumed.resume(checkpoint, 'yes');
        const actual = wire
          .at(-1)!
          .messages.find((message) => message.content.startsWith(prefix))!.content;
        const view = servedViews(resumed.getSnapshot()!).at(-1)!;
        const replay = view.messages.requestOnly.find(
          (message) => message.reason === 'findings-data',
        )?.text;
        expect(replay).toBe(actual);
        expect(Buffer.byteLength(actual)).toBeLessThanOrEqual(1024);
        expect(JSON.parse(actual.slice(prefix.length)).omitted.facts).toBe(1);
      });
    }
  }
});

describe('redacted replay keeps missing findings unknown', () => {
  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${mode}: an actual commit-time ledger redaction never reconstructs captured-empty DATA`, async () => {
      let index = 0;
      const wire: LLMRequest[] = [];
      const script = [
        call('c1', 'lookup'),
        call('c2', 'lookup', { _findings: fact('synthetic-private-reading') }),
        'done',
      ];
      const provider = mock({
        respond(request) {
          wire.push(JSON.parse(JSON.stringify(request)));
          return script[index++]!;
        },
      });
      const agent = Agent.create({
        provider,
        model: 'mock',
        reactMode: mode,
        redact: { keys: ['findingsLedger'] },
      })
        .tool(lookup)
        .findings()
        .build();
      await agent.run({ message: 'Inspect the fixture.' });
      const actual = wire
        .at(-1)!
        .messages.find((message) => message.content.startsWith(prefix))!.content;
      expect(JSON.parse(actual.slice(prefix.length)).data.facts).toHaveLength(1);
      const view = servedViews(agent.getSnapshot()!).at(-1)!;
      const frame = view.messages.requestOnly.find(
        (message) => message.reason === 'findings-data',
      )!.text;
      const reading = JSON.parse(frame.slice(prefix.length));
      expect(reading.ledgerStatus).toBe('unknown');
      expect(reading.sourceRowsOmitted).toBeNull();
      expect(reading.data.facts).toEqual([]);
      expect(frame).not.toContain('synthetic-private-reading');
    });
  }
});
