import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  isSaidByPerson,
  slidingWindow,
  withSourceEvidence,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';
import { withSourceFindingsRecovery } from '../../src/core/agent/sourceEvidence/findingsRecovery.js';
import {
  captureFindingsRequest,
  findingsReferenceRefusal,
} from '../../src/core/agent/findings/admission.js';
import type { ToolParty } from '../../src/tools/toolParty.js';

const STALE = 'old-source-PRIVATE-ID';
const LEGACY =
  'Copy an unambiguous tool_result id served to this response, or read the source again on a later call. No tool was invoked for this refused proposal.';

describe('mounted retained-source recovery after strict findings refusal', () => {
  it.each([
    ['unknown', undefined],
    ['empty', new Map()],
    ['partial', new Map([['find_source_evidence', { channel: 'registry' }]])],
    [
      'foreign provider',
      new Map([
        ['find_source_evidence', { channel: 'provider' }],
        ['read_source_evidence', { channel: 'registry' }],
      ]),
    ],
  ] as const)('does not advertise retained readers for an %s offer', (_label, offered) => {
    const original = findingsReferenceRefusal(
      { previous: [{ toolCallId: STALE, standing: 'fact' }] },
      undefined,
      1,
    );
    const recovered = JSON.parse(
      withSourceFindingsRecovery(original, offered as ReadonlyMap<string, ToolParty> | undefined)!,
    );
    expect(recovered.recovery.retry.previous).toBe('omit-unavailable-entries');
    expect(recovered.recovery).not.toHaveProperty('retainedSource');
    expect(JSON.stringify(recovered)).not.toContain('find_source_evidence');
    expect(JSON.stringify(recovered)).not.toContain(STALE);
  });

  it('does not turn an artifact receipt in a served body into an executed tool-result identity', () => {
    const ref = `art_${'a'.repeat(22)}`;
    const result = {
      role: 'tool' as const,
      toolName: 'read_source_evidence',
      toolCallId: 'actual-reader-id',
      content: JSON.stringify({ receipt: { ref } }),
    };
    const witness = captureFindingsRequest({ model: 'mock', messages: [result] }, [result], 1);
    expect(
      findingsReferenceRefusal({ previous: [{ toolCallId: ref, standing: 'fact' }] }, witness, 1),
    ).toContain('findings-reference');
    expect(
      findingsReferenceRefusal(
        { previous: [{ toolCallId: result.toolCallId, standing: 'fact' }] },
        witness,
        1,
      ),
    ).toBeUndefined();
  });

  it.each(['retained', 'expired', 'unmounted'] as const)(
    'keeps strict identity admission and recovers %s evidence without querying the source',
    async (mode) => {
      const store = inMemoryArtifacts(),
        identity = { principal: 'reader', conversationId: `recovery-${mode}` };
      let sourceCalls = 0,
        consumerCalls = 0,
        receipt = '',
        refusalSeen = false,
        readSeen = false;
      const source = withSourceEvidence(
        defineTool({
          name: 'read_fixture',
          description: 'Read the authored fixture.',
          execute: async () => {
            sourceCalls++;
            return { array: 'fixture-array', applications: 2 };
          },
        }),
        {
          describe: (value) => [
            {
              subject: { kind: 'array', value: value.array },
              operation: 'applications',
              scope: {},
              scalars: { applications: value.applications },
            },
          ],
        },
      );
      const consumer = defineTool({
        name: 'inspect_fixture',
        description: 'Inspect the current authorized fixture.',
        execute: async () => {
          consumerCalls++;
          return { inspected: true };
        },
      });
      const provider = mock({
        respond: (request) => {
          const question = request.messages.filter(isSaidByPerson).at(-1)?.content;
          const call = (name: string, args: Record<string, unknown>, id = name) => ({
            toolCalls: [{ id, name, args }],
          });
          if (question?.startsWith('Noise')) return 'Unrelated later turn.';
          const last = [...request.messages].reverse().find((message) => message.role === 'tool');
          if (question === 'Collect.')
            return last?.role === 'tool' ? 'Done.' : call('read_fixture', {}, STALE);
          const value = last?.role === 'tool' ? JSON.parse(last.content) : undefined;
          if (value?.refused === 'findings-reference') {
            refusalSeen = true;
            expect(sourceCalls).toBe(1);
            expect(consumerCalls).toBe(0);
            expect(last?.toolName).toBe('inspect_fixture');
            expect(JSON.stringify(value)).not.toContain(STALE);
            if (mode === 'unmounted') {
              expect(value.instruction).toBe(LEGACY);
              expect(value).not.toHaveProperty('recovery');
              return 'Unavailable.';
            }
            expect(value.instruction).not.toContain('read the source again');
            expect(value.recovery).toMatchObject({
              retry: { previous: 'omit-unavailable-entries' },
              currentReferences: {
                source: 'current-request',
                kind: 'executed-tool_result-id',
                artifactRefs: false,
              },
              retainedSource: {
                when: 'tools-offered',
                find: {
                  tool: 'find_source_evidence',
                  query: 'exact-declared-subject-operation-scope',
                  unknownFilters: 'omit',
                },
                read: {
                  tool: 'read_source_evidence',
                  refFrom: 'find_source_evidence.candidates[].ref',
                },
                refresh: 'never-automatic',
              },
            });
            expect(request.tools?.some((tool) => tool.name === 'find_source_evidence')).toBe(true);
            return call('find_source_evidence', {
              subject: { kind: 'array', value: 'fixture-array' },
            });
          }
          if (last?.role === 'tool' && last.toolName === 'find_source_evidence') {
            if (mode === 'expired') {
              expect(value.candidates).toEqual([]);
              return 'Unavailable.';
            }
            receipt = value.candidates[0].ref;
            return call('read_source_evidence', { ref: receipt });
          }
          if (last?.role === 'tool' && last.toolName === 'read_source_evidence') {
            expect(value).toMatchObject({
              historical: true,
              receipt: {
                ref: receipt,
                subject: { kind: 'array', value: 'fixture-array' },
                scalars: { applications: 2 },
              },
            });
            expect(last.toolCallId).not.toBe(receipt);
            readSeen = true;
            return call(
              'inspect_fixture',
              { _findings: { previous: [{ toolCallId: last.toolCallId, standing: 'fact' }] } },
              'repaired-consumer',
            );
          }
          if (last?.role === 'tool' && last.toolName === 'inspect_fixture') return 'Inspected.';
          expect(
            request.messages.some(
              (message) => message.role === 'tool' && message.toolCallId === STALE,
            ),
          ).toBe(false);
          return call(
            'inspect_fixture',
            { _findings: { previous: [{ toolCallId: STALE, standing: 'fact' }] } },
            'refused-consumer',
          );
        },
      });
      const builder = Agent.create({ provider, model: 'mock', artifacts: store })
        .tools([source, consumer])
        .findings()
        .window(slidingWindow({ keepRecentTurns: 1 }));
      if (mode !== 'unmounted') builder.sourceEvidence({ admit: (candidate) => candidate });
      const agent = builder.build();
      try {
        await agent.run({ message: 'Collect.', identity });
        if (mode === 'expired')
          await store.delete(identity, agent.checkpoint()!.sourceEvidence!.refs[0]);
        for (const message of ['Noise one.', 'Noise two.'])
          await agent.run({ message, identity, continueFrom: agent.checkpoint()! });
        const output = await agent.run({
          message: 'Recover the retained fixture-array.',
          identity,
          continueFrom: agent.checkpoint()!,
        });
        expect(refusalSeen).toBe(true);
        expect(sourceCalls).toBe(1);
        expect(consumerCalls).toBe(mode === 'retained' ? 1 : 0);
        expect(readSeen).toBe(mode === 'retained');
        expect(output).toBe(
          mode === 'retained'
            ? 'Inspected.\n\n---\n\nNot sure — a call was refused.'
            : 'Unavailable.\n\n---\n\nNot sure — a call was refused.',
        );
      } finally {
        await agent.shutdown();
      }
    },
  );
});
