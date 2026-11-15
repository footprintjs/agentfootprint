/** Advisory context must not contradict the native executed-result admission boundary. */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import type { LLMMessage, LLMRequest } from '../../../../src/provider-contract/types.js';
import { findingsFrame } from '../../../helpers/findingsData.js';
import { findingsContext } from '../../../../src/core/agent/findings/context.js';
import {
  captureFindingsRequest,
  findingsReferenceRefusal,
  referenceObservation,
} from '../../../../src/core/agent/findings/admission.js';
import { isResultMessage, knownResults } from '../../../../src/core/agent/findings/offer.js';
import { standingRowsFrom } from '../../../../src/core/agent/findings/ledger.js';
import {
  FINDINGS_ARGUMENT_SCHEMA,
  findingsAnswerSchema,
} from '../../../../src/core/agent/findings/reserved.js';

const result = (id: string, content = 'executed fixture body'): LLMMessage => ({
  role: 'tool',
  toolCallId: id,
  toolName: 'read_fixture',
  content,
});
const request = (messages: readonly LLMMessage[]): LLMRequest => ({ model: 'mock', messages });
const standing = (id: string, value = 'historical assertion') =>
  standingRowsFrom(
    [{ toolCallId: id, toolName: 'read_fixture', result: 'executed fixture body' }],
    {
      previous: [
        {
          toolCallId: id,
          standing: 'fact',
          assertions: [{ subject: { kind: 'fixture', id }, predicate: 'value', value }],
        },
      ],
    },
    'answer',
    1,
  )[0]!;
const context = (messages: readonly LLMMessage[], rows = [standing('notice')]) =>
  findingsFrame([{ content: findingsContext(messages, rows) }]);

describe('findings current-context result classification', () => {
  it.each(['not-entered', 'input-cancelled', 'outcome-unknown'] as const)(
    'keeps a %s notice out of result offers and identity readers',
    (origin) => {
      const notice = { ...result('notice'), toolResultOrigin: origin };
      const messages = [result('executed'), notice];
      const frame = context(messages);
      expect(isResultMessage(notice)).toBe(false);
      expect(frame.data.advisoryResultIds).toEqual(['executed']);
      expect(frame.data.undeclaredResultIds).toEqual(['executed']);
      expect(knownResults(messages).map((row) => row.toolCallId)).toEqual(['executed']);
      expect(
        knownResults(messages, [{ toolCallId: 'notice', result: 'native batch notice' }]).map(
          (row) => row.toolCallId,
        ),
      ).toEqual(['executed']);
      expect(frame.data.facts[0]).toMatchObject({
        toolCallId: 'notice',
        referenceStatus: 'not-current-context-result',
        assertions: [expect.objectContaining({ value: 'historical assertion' })],
      });
      expect(
        referenceObservation(captureFindingsRequest(request(messages), messages, 1), 1, 'notice'),
      ).toMatchObject({ identified: true, reason: 'not-a-result' });
    },
  );

  it('keeps valid batch-first identity resolution when no matching notice exists', () => {
    const batch = [{ toolCallId: 'batch-only', result: 'valid entered result' }];
    expect(knownResults([], batch)).toEqual(batch);
    expect(knownResults([result('batch-only')], batch)).toEqual(batch);
  });

  it('keeps historical assertions and classifies current results independently of old unknownId', () => {
    const current = { ...standing('current-A', 'current declaration'), unknownId: true };
    const frame = context([result('current-A')], [standing('historical-B'), current]);
    expect(frame.data.facts).toEqual([
      expect.objectContaining({
        toolCallId: 'historical-B',
        referenceStatus: 'not-current-context-result',
        assertions: [expect.objectContaining({ value: 'historical assertion' })],
      }),
      expect.objectContaining({
        toolCallId: 'current-A',
        unknownId: true,
        referenceStatus: 'current-context-result',
      }),
    ]);
  });

  it.each(['duplicate-result', 'result-and-notice'] as const)(
    'does not classify an ambiguous %s identity as a current context result',
    (mode) => {
      const first = result('same');
      const second =
        mode === 'duplicate-result'
          ? result('same')
          : { ...result('same'), toolResultOrigin: 'not-entered' as const };
      const frame = context([first, second], [standing('same')]);
      expect(frame.data.facts[0].referenceStatus).toBe('not-current-context-result');
      expect(
        findingsReferenceRefusal(
          { previous: [{ toolCallId: 'same', standing: 'fact' }] },
          captureFindingsRequest(request([first, second]), [first, second], 1),
          1,
        ),
      ).toContain('findings-reference');
    },
  );

  it('keeps executed bodies and collapsed ticket identities valid without interpreting their prose', () => {
    const body = result('body', 'refused: this is the actual entered tool return');
    const ticket = result('ticket', '{"collapsed":true,"standing":"noise","toolCallId":"ticket"}');
    const messages = [body, ticket];
    const frame = context(messages, [standing('body'), standing('ticket')]);
    expect(frame.data.advisoryResultIds).toEqual(['ticket', 'body']);
    expect(frame.data.facts.map((row: { referenceStatus: string }) => row.referenceStatus)).toEqual(
      ['current-context-result', 'current-context-result'],
    );
    const capture = captureFindingsRequest(request(messages), [body, result('ticket')], 1);
    expect(referenceObservation(capture, 1, 'ticket')).toMatchObject({
      identified: true,
      execution: 'result',
      visibility: 'ticket',
    });
    expect(
      findingsReferenceRefusal(
        {
          previous: messages.map((message) => ({
            toolCallId: message.toolCallId!,
            standing: 'fact' as const,
          })),
        },
        capture,
        1,
      ),
    ).toBeUndefined();
  });

  it('describes only executed results in the current request in both stable schemas', () => {
    for (const schema of [FINDINGS_ARGUMENT_SCHEMA, findingsAnswerSchema()]) {
      const previous = (schema.properties as Record<string, any>).previous;
      expect(previous.description).toContain('executed tool results in the current request');
      expect(previous.description).toContain('Historical declaration IDs');
      expect(previous.items.properties.toolCallId.enum).toBeUndefined();
    }
  });

  it('does not re-offer an actual refused call on the next request or turn it into evidence', async () => {
    const calls: string[] = [],
      requests: LLMRequest[] = [];
    const proposal = (id: string, previous?: string) => ({
      toolCalls: [
        {
          id,
          name: 'read_fixture',
          args: {
            q: id,
            ...(previous && {
              _findings: {
                basis: 'direct',
                previous: [{ toolCallId: previous, standing: 'fact' }],
              },
            }),
          },
        },
      ],
    });
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        respond(req) {
          requests.push(req);
          if (requests.length === 1) return proposal('executed');
          if (requests.length === 2) return proposal('refused', 'foreign-PRIVATE-ID');
          const frame = findingsFrame(req.messages);
          expect(frame.data.advisoryResultIds).not.toContain('refused');
          expect(frame.data.undeclaredResultIds).not.toContain('refused');
          expect(frame.data.advisoryResultIds).toContain('executed');
          const refusal = req.messages.find(
            (message) => message.role === 'tool' && message.toolCallId === 'refused',
          );
          expect(refusal?.content).toContain('findings-reference');
          expect(refusal?.content).not.toContain('foreign-PRIVATE-ID');
          if (requests.length === 3) return proposal('refused-again', 'refused');
          if (requests.length === 4) {
            expect(calls).toEqual(['executed']);
            expect(
              req.messages.find(
                (message) => message.role === 'tool' && message.toolCallId === 'refused-again',
              )?.content,
            ).toContain('findings-reference');
            return proposal('accepted-retry', 'executed');
          }
          expect(requests.length).toBe(5);
          return 'Done.';
        },
      }),
    })
      .tool(
        defineTool({
          name: 'read_fixture',
          description: 'Read a synthetic fixture.',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          execute({ q }: { q: string }) {
            calls.push(q);
            return 'executed fixture body';
          },
        }),
      )
      .findings()
      .maxIterations(6)
      .build();
    try {
      expect(await agent.run({ message: 'Read the fixture.' })).toBe('Done.');
      expect(calls).toEqual(['executed', 'accepted-retry']);
    } finally {
      await agent.shutdown();
    }
  });

  it('leaves an empty projection and an agent without findings free of reference statuses', async () => {
    const empty = context([], []);
    expect(JSON.stringify(empty)).not.toContain('referenceStatus');
    const requests: LLMRequest[] = [];
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        respond(req) {
          requests.push(req);
          return 'Done.';
        },
      }),
    }).build();
    try {
      expect(await agent.run({ message: 'Finish without findings.' })).toBe('Done.');
      expect(requests).toHaveLength(1);
      expect(
        requests[0]!.messages.some((message) =>
          message.content.includes('[AgentFootprint findings DATA v1]'),
        ),
      ).toBe(false);
      expect(JSON.stringify(requests[0])).not.toContain('referenceStatus');
    } finally {
      await agent.shutdown();
    }
  });
});
