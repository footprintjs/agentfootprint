import { describe, expect, it, vi } from 'vitest';

import { Agent, defineRAG, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import { InMemoryStore } from '../../../../src/memory/store/InMemoryStore.js';
import { defineOntology } from '../../../../src/ontology/index.js';
import { epochLocations, readAfterCall } from '../../../../src/time-travel/index.js';

const reply = 'Here is the general guidance.';
const passage = 'Private reference passage 🐾';
const candidate = {
  id: 'reference',
  score: 0.3,
  entry: {
    id: 'reference',
    value: { role: 'user', content: passage },
    updatedAt: 1,
    lastAccessedAt: 1,
  },
};
const acknowledge = defineTool({
  name: 'acknowledge',
  description: 'Acknowledge the question.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'Acknowledged',
});

describe.each(['dynamic', 'dynamic-grouped'] as const)('recorded retrieval in %s', (reactMode) => {
  it.each(['score floor', 'timeout', 'empty', 'included'] as const)('%s', async (testCase) => {
    const searchWithOutcome = vi
      .fn()
      .mockResolvedValue(
        testCase === 'timeout'
          ? { ok: false, code: 'timeout' }
          : { ok: true, value: testCase === 'empty' ? [] : [candidate] },
      );
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      searchWithOutcome,
    });
    const prompts: (string | undefined)[] = [];
    const provider = mock({
      respond: (request) => {
        prompts.push(request.systemPrompt);
        return prompts.length === 1
          ? { content: '', toolCalls: [{ id: 'a1', name: 'acknowledge', args: {} }] }
          : { content: reply, toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', reactMode, recordReceipt: false })
      .rag(defineRAG({ id: 'docs', store, threshold: testCase === 'included' ? 0.1 : 0.9 }))
      .tool(acknowledge)
      .build();
    const capture = recordRun(agent);
    try {
      const answer = await agent.run({ message: 'What should I know?' });
      const saved = JSON.parse(JSON.stringify(capture.toRecording()));
      const facts = saved.snapshot.sharedState.findingsLedger.filter(
        (row: { kind: string }) => row.kind === 'retrieval-request',
      );
      expect(searchWithOutcome).toHaveBeenCalledOnce();
      expect(facts).toHaveLength(2);
      expect(facts.map((row: { accepted: string }) => row.accepted)).toEqual(
        Array(2).fill(testCase === 'included' ? 'present' : 'absent'),
      );
      const assessment = assessAnswer(saved);
      const live = await agent.assessment();
      expect(live?.reasons).toEqual(assessment.reasons);
      const reasons = assessment.reasons.map(({ reason }) => reason);

      if (testCase === 'score floor' || testCase === 'timeout') {
        const clause =
          testCase === 'timeout'
            ? 'a memory search timed out'
            : 'memory search found nothing above the score floor (1 candidate fell below it)';
        expect(answer).toBe(`${reply}\n\n---\n\nNot sure — ${clause}.`);
        expect(reasons).toContain(
          testCase === 'timeout' ? 'memory-retrieval-timeout' : 'memory-retrieval-excluded',
        );
        const explanation = accountForAnswer(saved);
        expect(explanation.answer.value).toBe(reply);
        expect(explanation.facts.limitsBlock.value).toBe(`Not sure — ${clause}.`);
      } else {
        expect(answer).toBe(reply);
        expect(reasons).not.toContain('memory-retrieval-excluded');
        expect(reasons).not.toContain('memory-retrieval-timeout');
      }
      if (testCase === 'included')
        expect(prompts.every((prompt) => prompt?.includes(passage))).toBe(true);
    } finally {
      capture.stop();
      await agent.shutdown();
    }
  });

  it('commits recall and the proved source-link consumer on the accepted call', async () => {
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      searchWithOutcome: vi.fn().mockResolvedValue({ ok: true, value: [candidate] }),
    });
    const provider = mock({
      replies: [
        { toolCalls: [{ id: 'a1', name: 'acknowledge', args: {} }] },
        { content: reply, toolCalls: [] },
      ],
    });
    const agent = Agent.create({ provider, model: 'mock', reactMode })
      .rag(defineRAG({ id: 'docs', store, threshold: 0.1 }))
      .tool(acknowledge)
      .build();
    const capture = recordRun(agent);
    try {
      expect(await agent.run('What should I know?')).toBe(reply);
      const recording = capture.toRecording();
      const final = epochLocations(recording.snapshot).at(-1);
      if (final === undefined) throw new Error('Expected an accepted call.');
      const recall = expect.objectContaining({
        kind: 'retrieval-request',
        iteration: 2,
        accepted: 'present',
      });
      if (reactMode === 'dynamic-grouped')
        expect(readAfterCall(final, 'retrievalRequest')).toEqual(recall);
      else expect(readAfterCall(final, 'findingsLedger')).toEqual(expect.arrayContaining([recall]));
      expect(readAfterCall(final, 'sourceLinkConsumer')).toMatchObject({
        consumer: final.callRuntimeStageId,
        historyPositions: [{ occurrence: expect.any(String), element: expect.any(Number) }],
      });
    } finally {
      capture.stop();
      await agent.shutdown();
    }
  });

  it('records recall outcomes and an unconsulted declared source in the same request', async () => {
    const searchWithOutcome = vi.fn().mockResolvedValue({ ok: false, code: 'timeout' });
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      searchWithOutcome,
    });
    const execute = vi.fn(() => 'Monitor result');
    const agent = Agent.create({ provider: mock({ reply }), model: 'mock', reactMode })
      .rag(defineRAG({ id: 'docs', store }))
      .tool(
        defineTool({
          name: 'monitor',
          description: 'Read link observations.',
          inputSchema: { type: 'object', properties: {} },
          execute,
        }),
      )
      .ontology(
        defineOntology({
          id: 'switch-stack',
          version: '1',
          nodes: {
            link_observation: {
              meaning: 'Current evidence for a link',
              sources: [{ source: 'monitor_data', via: ['monitor'] }],
            },
          },
          sources: { monitor_data: { meaning: 'Link observations after changes' } },
        }),
      )
      .answerLayer({ sourceNotConsulted: true })
      .build();
    const capture = recordRun(agent);
    try {
      await agent.run({ message: 'Give the link observation.' });
      expect(execute).not.toHaveBeenCalled();
      expect(searchWithOutcome).toHaveBeenCalledOnce();
      const saved = JSON.parse(JSON.stringify(capture.toRecording()));
      const reasons = assessAnswer(saved).reasons;
      expect(reasons.map(({ reason }) => reason)).toEqual(
        expect.arrayContaining(['source-not-consulted', 'memory-retrieval-timeout']),
      );
      expect((await agent.assessment())?.reasons).toEqual(reasons);
    } finally {
      capture.stop();
      await agent.shutdown();
    }
  });
});
