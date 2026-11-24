import { expect, it } from 'vitest';
import { Agent, receiptAt, servedAt } from '../../index.js';
import { mock } from '../../adapters/llm/MockProvider.js';
import { decideSkill, defineSkill, skillGraph } from '../../injection-engine.js';
import { type Recording, recordRun } from '../../recorders/observability/recordRun.js';
import type { LLMToolSchema } from '../../provider-contract/types.js';

for (const commitValues of ['delta', 'full'] as const) {
  it.each(['catalog', 'tree'] as const)(
    'records the role-visible %s decision beside its accepted request (' + commitValues + ')',
    async (shape) => {
      const offered: (readonly LLMToolSchema[])[] = [];
      const catalogs: unknown[] = [];
      const day = defineSkill({
        id: 'day',
        description: 'Day shift',
        body: 'Use the morning schedule.',
      });
      const night = defineSkill({
        id: 'night',
        description: 'Night shift',
        body: 'Use the evening schedule.',
      });
      const builder = Agent.create({
        model: 'mock',
        commitValues,
        provider: mock({
          respond: (request) => {
            offered.push(request.tools ?? []);
            return 'Done.';
          },
        }),
        permissionChecker: {
          name: 'shift',
          governs: ['skill_read'],
          check: ({ target }) =>
            target === 'skill:day' ? { result: 'allow' } : { result: 'deny' },
        },
      });
      if (shape === 'catalog') builder.skill(day).skill(night);
      else
        builder.skillGraph(
          skillGraph({
            skills: [day, night],
            tree: decideSkill(() => true, day, night),
            check: 'throw',
          }),
        );
      const agent = builder.build();
      agent.on('agentfootprint.context.evaluated', (event) => {
        const { skillCatalog, skippedDetails, evaluatedTotal } = event.payload;
        catalogs.push({ skillCatalog, skippedDetails, evaluatedTotal });
      });
      const recorder = recordRun(agent);
      try {
        await agent.run({ message: 'Show today’s schedule.' });
        const { snapshot } = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
        expect(offered).toHaveLength(1);
        const replay = servedAt(snapshot, 1);
        expect(replay?.tools.schemas).toEqual(offered[0]);
        expect(catalogs).toEqual([
          {
            skillCatalog: [{ id: 'day', description: 'Day shift' }],
            skippedDetails: [],
            evaluatedTotal: 1,
          },
        ]);
        const selection = receiptAt(snapshot, 1)?.toolSelection;
        if (shape === 'catalog') {
          expect(offered[0]).toMatchObject([
            { name: 'read_skill', inputSchema: { properties: { id: { enum: ['day'] } } } },
          ]);
          expect(selection).toBeUndefined();
        } else {
          expect(offered[0]).toEqual([]);
          expect(selection).toEqual({
            consumer: { series: replay?.callRuntimeStageId, attempt: 1 },
            absent: [],
            skillCatalog: { names: ['day'], count: 1, reason: 'tree-routed' },
          });
        }
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    },
  );
}
