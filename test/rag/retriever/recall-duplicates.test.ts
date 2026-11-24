import { describe, expect, it, vi } from 'vitest';

import { Agent, defineRAG } from '../../../src/index.js';
import type { RetrievalRequestRow } from '../../../src/core/agent/honesty/retrievalRequests.js';
import type { MemoryAttachedPayload } from '../../../src/events/payloads/memory.js';
import { mock } from '../../../src/llm-providers.js';
import { memoryRecallOutcomesKey, retrievalEvidenceKey } from '../../../src/memory/define.types.js';
import { semanticPipeline } from '../../../src/memory/pipeline/semantic.js';
import type { MemoryRecallOutcome } from '../../../src/memory/retrieval/outcome.js';
import { InMemoryStore } from '../../../src/memory/store/InMemoryStore.js';
import { recordRun } from '../../../src/observe.js';

const id = 'docs';
const older = { content: 'Older handbook passage.', docUri: 'older-handbook.md' };
const newer = { content: 'Newer policy passage.', docUri: 'newer-policy.md' };
const reply = 'Finished.';
const both = [older, newer];
const sourceBlock = ({ content, docUri }: typeof older) =>
  `<source id="same" doc="${docUri}">\n${content}\n</source>`;

describe.each(['full', 'ids-only'] as const)('duplicate store IDs with %s recording', (mode) => {
  it.each([
    { name: 'entry cap retains the newer occurrence', maxEntries: 1, selected: [newer] },
    { name: 'both occurrences survive in chronological order', maxEntries: 2, selected: both },
  ])('$name', async ({ maxEntries, selected }) => {
    const searchWithOutcome = vi.fn().mockResolvedValue({
      ok: true,
      value: both.map(({ content, docUri }, index) => ({
        entry: {
          id: 'same',
          value: { role: 'user', content, metadata: { docUri } },
          updatedAt: index + 1,
        },
        score: index === 0 ? 0.99 : 0.75,
      })),
    });
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      searchWithOutcome,
    });
    const recording = mode === 'ids-only' ? { recording: 'ids-only' as const } : {};
    // The normal RAG mount, with the semantic pipeline's downstream picker cap.
    const { read } = semanticPipeline({ store, flavor: 'rag', k: 2, maxEntries, ...recording });
    const prompts: (string | undefined)[] = [];
    const agent = Agent.create({
      model: 'mock',
      recordReceipt: false,
      provider: mock({
        respond(request) {
          prompts.push(request.systemPrompt);
          return { content: reply, toolCalls: [] };
        },
      }),
    })
      .rag({ ...defineRAG({ id, store, ...recording }), read })
      .build();

    const attached: MemoryAttachedPayload[] = [];
    agent.on('agentfootprint.memory.attached', ({ payload }) => attached.push(payload));
    const capture = recordRun(agent);
    try {
      expect(await agent.run({ message: 'Read the current policy.' })).toBe(reply);
      expect(searchWithOutcome).toHaveBeenCalledOnce();
      expect(prompts).toHaveLength(1);

      // Keep the selected bodies and order, with each body's own URI and no borrowed score.
      expect(prompts[0]?.match(/<source\b[^>]*>[\s\S]*?<\/source>/g)).toEqual(
        selected.map(sourceBlock),
      );
      const expectedAttachments = selected.map(({ content }) => ({
        memoryId: 'same',
        contentSummary: mode === 'ids-only' ? '[REDACTED]' : content,
        source: 'store',
      }));
      expect(attached).toEqual(expectedAttachments);

      const saved = capture.toRecording();
      expect(
        saved.events
          .filter(({ type }) => type === 'agentfootprint.memory.attached')
          .map(({ payload }) => payload),
      ).toEqual(expectedAttachments);

      const state = saved.snapshot?.sharedState;
      const exclusions = maxEntries === 1 ? { 'over-max-entries': 1 } : {};
      const evidence = state?.[retrievalEvidenceKey(id)];
      expect(evidence).toMatchObject({
        candidateIdsAmbiguous: true,
        consideredCount: 2,
        admittedCount: selected.length,
        rejectedCount: 2 - selected.length,
        candidatesComplete: false,
      });
      expect(evidence).not.toHaveProperty('candidates');
      expect(evidence).not.toHaveProperty('promptRanges');

      const [outcome] = state?.[memoryRecallOutcomesKey(id)] as readonly MemoryRecallOutcome[];
      expect(outcome).toMatchObject({
        kind: 'ok',
        complete: true,
        candidateCount: 2,
        admittedCount: selected.length,
        candidatesComplete: false,
      });
      expect(outcome.exclusions).toEqual(exclusions);
      expect(outcome).not.toHaveProperty('candidates');

      const injections = state?.systemPromptInjections as
        | readonly { source: string; sourceId: string }[]
        | undefined;
      expect(injections?.filter(({ source }) => source === 'rag')).toEqual([
        expect.objectContaining({ sourceId: 'memory:docs' }),
      ]);
      expect(injections?.find(({ source }) => source === 'rag')).not.toHaveProperty(
        'retrievalScore',
      );
      expect(injections?.find(({ source }) => source === 'rag')).not.toHaveProperty('rankPosition');

      const facts = (state?.findingsLedger as readonly RetrievalRequestRow[]).filter(
        ({ kind }) => kind === 'retrieval-request',
      );
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        accepted: 'present',
        exposure: 'present',
        committedProviderResponse: true,
      });
      expect(facts[0]?.sources).toEqual([
        {
          kind: 'ok',
          complete: true,
          candidateCount: 2,
          admittedCount: selected.length,
          exclusions,
        },
      ]);
      expect(facts[0]).not.toHaveProperty('acceptedCount');
    } finally {
      capture.stop();
      await agent.shutdown();
    }
  });
});
