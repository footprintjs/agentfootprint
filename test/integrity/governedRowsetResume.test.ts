import type { AgentfootprintEvent } from '../../src/events.js';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  ask,
  askHuman,
  checkInApproved,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  withSourceEvidence,
  type ToolExecutionContext,
  type AwaitingInput,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';
import type { CredentialProvider } from '../../src/identity/types.js';
import { pausedRequest } from '../helpers/pausedRequest.js';

const KIND = 'dataset/native-rowset-resume';
const rowsets = [
  {
    key: 'measurements',
    columns: { amount: 'number' as const },
    source: {
      kind: 'published-dataset' as const,
      refPath: ['dataset'],
      artifactKind: KIND,
      maxRows: 1000,
      maxBytes: 1048576,
    },
  },
];

describe('native final rowsets on each executing resume door', () => {
  for (const door of ['check-in', 'ask', 'credential'] as const)
    it.each(['clean', 'warn', 'enforce'] as const)(
      `${door} %s shares actual publication with SourceEvidence`,
      async (behavior) => {
        const store = inMemoryArtifacts();
        const events: AgentfootprintEvent[] = [];
        let granted = false,
          executions = 0,
          descriptions = 0;
        let served = '';
        const credentials: CredentialProvider = {
          id: 'fixture-vault',
          getCredential: async () =>
            granted
              ? { status: 'issued', credential: { kind: 'fixture', toHeaders: () => ({}) } }
              : {
                  status: 'authorization-required',
                  authorizationUrl: 'https://example.test/authorize',
                  sessionId: 'rowset-fixture',
                },
        };
        const build = () => {
          const tool = withSourceEvidence(
            defineTool({
              name: 'rowset_source',
              description: 'Read synthetic measurements.',
              resultRowsets: rowsets,
              ...(door === 'check-in' && { checkIn: 'always' as const }),
              ...(door === 'credential' && {
                needs: { credential: 'fixture', mode: 'user' as const },
              }),
              async execute(_args: Record<string, unknown>, context: ToolExecutionContext) {
                executions++;
                const dataset = await context.artifacts.put({
                  kind: KIND,
                  mediaType: 'application/json',
                  digest: 'sha-256',
                  data: [{ amount: behavior === 'clean' ? 0 : 'RESUME-PRIVATE-CANARY' }],
                });
                return { subject: 'synthetic-subject', dataset: dataset.ref };
              },
            }),
            {
              datasets: [
                {
                  key: 'measurements',
                  refPath: ['dataset'],
                  kind: KIND,
                  fields: { amount: ['amount'] },
                  maxRows: 1000,
                  maxBytes: 1048576,
                },
              ],
              describe(served, sources) {
                descriptions++;
                return sources.measurements
                  ? [
                      {
                        subject: { kind: 'fixture', value: served.subject },
                        operation: 'measurements',
                        scope: {},
                        datasets: [
                          {
                            key: 'measurements',
                            ref: sources.measurements.ref,
                            kind: KIND,
                            fields: { amount: ['amount'] },
                          },
                        ],
                      },
                    ]
                  : [];
              },
            },
          );
          const builder = Agent.create({
            model: 'mock',
            artifacts: store,
            integrityPosture: 'dev',
            checkColumnTypes: behavior === 'enforce' ? 'enforce' : 'warn',
            ...(door === 'credential' && { credentials }),
            provider: mock({
              respond(request) {
                const last = request.messages.at(-1);
                if (last?.role === 'tool') {
                  served = last.content;
                  return 'Measured.';
                }
                return {
                  toolCalls: [{ id: 'shared-provider-call-id', name: 'rowset_source', args: {} }],
                };
              },
            }),
          })
            .tool(tool)
            .sourceEvidence({ admit: (candidate) => candidate });
          if (door === 'ask')
            builder.toolMiddleware({
              name: 'fixture-consent',
              onToolCall: () => ask({ question: 'Allow?' }),
              onToolResult: () => allow(),
            });
          const agent = builder.build();
          agent.on('*', (event) => events.push(event));
          return agent;
        };
        const first = build();
        const paused = await first.run({
          message: 'Read.',
          identity: { conversationId: `rowsets-${door}-${behavior}` },
        });
        if (!isPaused(paused)) return expect.fail('Expected actual native consent pause.');
        expect(executions).toBe(0);
        expect(
          events.filter((event) => event.type === 'agentfootprint.tools.rowset_checked'),
        ).toEqual([]);
        granted = true;
        const resumed = build();
        await resumed.resume(
          JSON.parse(JSON.stringify(paused.checkpoint)),
          door === 'credential'
            ? undefined
            : checkInApproved({ request: pausedRequest(paused), by: 'fixture-owner' }),
        );
        expect(executions).toBe(1);
        const checks = events
          .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
          .map((event) => event.payload);
        expect(checks).toMatchObject([
          {
            toolCallId: 'shared-provider-call-id',
            rowset: 'measurements',
            reason: 'rows',
            disposition: behavior === 'clean' ? 'checked-pass' : 'checked-fail',
            delivery: behavior === 'enforce' ? 'refused' : 'unchanged',
          },
        ]);
        if (behavior === 'enforce') {
          expect(served).toMatch(/^Result rejected:/);
          expect(descriptions).toBe(0);
          expect(resumed.checkpoint()?.sourceEvidence?.refs).toEqual([]);
        } else {
          expect(served).toContain('synthetic-subject');
          expect(descriptions).toBe(1);
          expect(resumed.checkpoint()?.sourceEvidence?.refs).toHaveLength(1);
        }
      },
    );
});

describe('native no-result rowset accounting', () => {
  it('accounts only untouched rowset siblings after an actual tool-owned pause', async () => {
    let executions = 0;
    const events: AgentfootprintEvent[] = [];
    const pause = defineTool({
      name: 'ask_first',
      description: 'Ask first.',
      execute: () => askHuman({ question: 'Continue?' }),
    });
    const rows = defineTool({
      name: 'read_later',
      description: 'Read synthetic rows later.',
      resultRowsets: [
        { key: 'rows', columns: { amount: 'number' }, source: { kind: 'inline', path: [] } },
      ],
      execute: () => {
        executions++;
        return [{ amount: 'bad' }];
      },
    });
    const agent = Agent.create({
      model: 'mock',
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'first', name: 'ask_first', args: {} },
              { id: 'later', name: 'read_later', args: {} },
            ],
          },
          'Done.',
        ],
      }),
    })
      .tools([pause, rows])
      .build();
    agent.on('*', (event) => events.push(event));
    const paused = await agent.run({ message: 'Ask then read.' });
    if (!isPaused(paused)) return expect.fail('Expected the actual first tool pause.');
    expect(executions).toBe(0);
    await agent.resume(paused.checkpoint, 'Continue.');
    expect(executions).toBe(0); // Native settlement does not execute the sibling.
    expect(events.filter((event) => event.type === 'agentfootprint.tools.rowset_checked')).toEqual(
      [],
    );
    expect(
      events.filter((event) => event.type === 'agentfootprint.integrity.context_error'),
    ).toEqual([]);
  });
  it('accounts a rowset-only argument pause and checks the real resumed value', async () => {
    const events: AgentfootprintEvent[] = [];
    let executed = 0;
    const tool = defineTool({
      name: 'argument_source',
      description: 'Read synthetic measurement.',
      inputSchema: {
        type: 'object',
        properties: { subject: { type: 'string' } },
        required: ['subject'],
      },
      askOrAssume: { subject: { ask: 'Which subject?' } },
      resultRowsets: [
        { key: 'root', columns: { amount: 'number' }, source: { kind: 'inline', path: [] } },
      ],
      execute: () => {
        executed++;
        return [{ amount: 'wrong-type' }];
      },
    });
    const agent = Agent.create({
      model: 'mock',
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'ask-source', name: 'argument_source', args: {} }] },
          'Measured.',
        ],
      }),
    })
      .tool(tool)
      .findings({ argumentSources: true })
      .build();
    agent.on('*', (event) => events.push(event));
    const paused = await agent.run({ message: 'Read measurement.' });
    if (!isPaused(paused)) return expect.fail('Expected native argument pause.');
    expect(executed).toBe(0);
    expect(events.filter((event) => event.type === 'agentfootprint.tools.rowset_checked')).toEqual(
      [],
    );
    const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
    const input = (checkpoint.pauseData as { awaitingInput: AwaitingInput }).awaitingInput;
    expect(input.fields).toHaveLength(1);
    await agent.resume(checkpoint, {
      requestId: input.requestId,
      values: { [input.fields[0]!.id]: 'synthetic-subject' },
    });
    expect(executed).toBe(1);
    expect(
      events
        .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
        .map((event) => event.payload),
    ).toMatchObject([{ disposition: 'checked-fail', delivery: 'refused' }]);
  });

  it('does not treat a human answer to a tool-owned pause as a produced rowset', async () => {
    const events: AgentfootprintEvent[] = [];
    const tool = defineTool({
      name: 'plain_pause',
      description: 'Ask a person.',
      resultRowsets: rowsets,
      execute: () => askHuman({ question: 'Continue?' }),
    });
    const agent = Agent.create({
      model: 'mock',
      artifacts: inMemoryArtifacts(),
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
      provider: mock({
        replies: [{ toolCalls: [{ id: 'pause', name: 'plain_pause', args: {} }] }, 'Done.'],
      }),
    })
      .tool(tool)
      .build();
    agent.on('*', (event) => events.push(event));
    const paused = await agent.run({ message: 'Ask.' });
    if (!isPaused(paused)) return expect.fail('Expected native tool pause.');
    await agent.resume(paused.checkpoint, { dataset: 'not-a-native-publication' });
    expect(events.filter((event) => event.type === 'agentfootprint.tools.rowset_checked')).toEqual(
      [],
    );
    expect(
      events.filter((event) => event.type === 'agentfootprint.integrity.context_error'),
    ).toEqual([]);
  });
});
