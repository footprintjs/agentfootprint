import { expect, it } from 'vitest';
import { Agent, defineTool, receiptAt } from '../../index.js';
import { mock } from '../../adapters/llm/MockProvider.js';
import { defineSkill } from '../../injection-engine.js';
import { recordRun } from '../../recorders/observability/recordRun.js';

for (const mode of ['delta', 'full'] as const) {
  it.each(['activate', 'always offered', 'removed'] as const)(
    'records only a native omission actually decided for this request (%s, ' + mode + ')',
    async (scenario) => {
      const menus: string[][] = [];
      let reads = 0;
      const tools = [
        defineTool({
          name: 'monitor',
          description: 'Read the pressure gauge',
          inputSchema: { type: 'object', properties: {} },
          execute: () => {
            reads++;
            return 'Measured.';
          },
        }),
      ];
      const agent = Agent.create({
        model: 'mock',
        commitValues: mode,
        provider: mock({
          respond(req) {
            menus.push((req.tools ?? []).map((tool) => tool.name));
            if (scenario === 'activate' && menus.length === 1)
              return {
                toolCalls: [{ id: 'open', name: 'read_skill', args: { id: 'diagnostics' } }],
              };
            if (scenario === 'activate' && menus.length === 2)
              return { toolCalls: [{ id: 'read', name: 'monitor', args: {} }] };
            return 'Finished.';
          },
        }),
      })
        .skill(
          defineSkill({
            id: 'diagnostics',
            description: 'Read pressure.',
            body: 'Read the gauge.',
            tools,
            ...(scenario === 'always offered' ? {} : { autoActivate: 'currentSkill' as const }),
          }),
        )
        .build();
      if (scenario === 'removed') tools.splice(0);
      const recorder = recordRun(agent);
      try {
        await agent.run({ message: 'Check pressure.' });
        const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
        expect(menus.map((menu) => menu.includes('monitor'))).toEqual(
          scenario === 'activate' ? [false, true, true] : [scenario === 'always offered'],
        );
        expect(reads).toBe(scenario === 'activate' ? 1 : 0);
        expect(
          menus.map((_, i) => receiptAt(recording.snapshot, i + 1)?.toolSelection?.absent ?? []),
        ).toEqual(
          scenario === 'activate' ? [[{ name: 'monitor', reason: 'skill-scope' }], [], []] : [[]],
        );
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    },
  );
}
