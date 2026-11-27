/**
 * One interval, two labelled zones.
 * Run: npm run example examples/features/viewer-display-zone.ts
 */
import { Agent, absent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/viewer-display-zone',
  title: 'A viewer zone for display',
  group: 'features',
  description:
    'A scripted agent keeps the exact UTC interval while showing both its interpretation and viewer zones.',
  defaultInput: 'Read the selected window.',
  providerSlots: [],
  tags: ['features', 'tools'],
};

const from = '2026-11-13T11:00:00Z',
  to = '2026-11-13T13:00:00Z';
const readWindow = defineTool({
  name: 'read_window',
  description: 'Read the selected UTC interval.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () =>
    absent({
      what: 'matching items',
      checked: ['synthetic fixture'],
      period: { queried: { from, to }, held: { from, to } },
    }),
});

// #region viewer-display-zone
export async function run(message: string): Promise<string> {
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'read', name: 'read_window', args: {} }] },
        { content: 'No matching items.' },
      ],
    }),
  })
    .tool(readWindow)
    .time({ zone: 'America/Los_Angeles' })
    .limitsTravelWithTheAnswer()
    .build();
  try {
    const answer = await agent.run({
      message,
      time: {
        now: '2026-11-13T14:00:00Z',
        window: {
          from,
          to,
          end: 'exclusive',
          precision: 'minute',
        },
      },
      timeDisplay: { viewerZone: 'America/New_York' },
    });
    if (typeof answer !== 'string' || !answer.includes('viewer display:')) {
      throw new Error('Expected an answer with a labelled viewer display.');
    }
    return answer;
  } finally {
    await agent.shutdown();
  }
}
// #endregion viewer-display-zone

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
