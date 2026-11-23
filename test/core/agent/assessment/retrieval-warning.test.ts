import { describe, expect, it, vi } from 'vitest';

import { Agent, defineRAG, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import { InMemoryStore } from '../../../../src/memory/store/InMemoryStore.js';

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
});
