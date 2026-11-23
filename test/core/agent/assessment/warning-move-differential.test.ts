import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import { assessmentDataOf } from '../../../../src/core/agent/assessment/compose.js';
import { Agent, askHuman, coverage, defineTool, isPaused } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import {
  FLAGSHIP_RUN_ID,
  HOST_APP_DECLARATIONS,
  fixtureA,
} from '../../../answer-account/helpers.js';

type Recording = ReturnType<ReturnType<typeof recordRun>['toRecording']>;

const legacy = JSON.parse(
  readFileSync(
    new URL('./fixtures/recordings-made-before-call-occurrence.json', import.meta.url),
    'utf8',
  ),
) as Record<string, { recording: Parameters<typeof assessAnswer>[0] }>;

// SHA-256 of the JSON emitted by main at 06950d07 before the move.
// The recorded coverage case includes the Answer Account template version.
// That pin is from baa44ef50, where #468 raised it from 24 to 25.
const before: Readonly<Record<string, string>> = {
  'clean, two calls': '94812b2e229fec380a2615ddc09f172c3a6364e1d9680e187cdc94196a0fd9b1',
  'clean, the same id twice': '18bfe1296e6eddf95a2079fd85b098d8e26c75705316edaa08ea4abf5433cd96',
  'an assumed argument': 'b125d28765e1868a3b832738572df5e29b70e710fa6f5d7aa4a5bdebea6fadb0',
  'an assumed argument, the same id twice':
    'e5ea5f904f1da7bd24d2af8ba4d8581e3fdbb8b3b6d998d61f539e11a83935f3',
  'the tool throws': 'bc7cbe8d1cd175432833f57428c716824c3ce3a7b6f65e26f38ddbe8ab5c59c3',
  'unfinished work': '2f2514947cb69dded8b89aa763c939a4de8ac7332f69902291e4e3ce79cc0b96',
  'ground not covered': 'e3711faed7748cea6cf3dffff1d4aeebec4d4871ef4adf094ea2437a53c03d5c',
  'nothing matched': '0c6193733bfa0629f1f0759e1e3e5bbd2b8c68f104599ca975b90e0ba6af8fe4',
  'the call is refused': '6df690ac9fd558cd155ce0f2c961b730fce78540cce90f437c11835471cc0a20',
  'the result is kept out, ground not covered':
    '5e699729cbb28a31cb9655a243d26dee03955dfae3f4d27e29b3739c3ce4d118',
  'recorded coverage': '78418f13862e782cee999e53909979f91b75bdadce2c9c26ae39b01c41497441',
  'waiting on a person': 'b7b3717025a682a8433b2d1d492ad835229a6bb78a0e36ff6cad8819841a02e1',
  'resumed answer': '62c3c38ed3ed30a9264c56728a0abeba36688581af27e87c02126118b926242c',
};

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const tool = (name: string, execute: () => unknown) =>
  defineTool({
    name,
    description: `Run the ${name} operation.`,
    inputSchema: { type: 'object', properties: {} },
    execute,
  });

it('preserves full fold and served warning bytes from before the stage move', async () => {
  const actual = Object.fromEntries(
    Object.entries(legacy).map(([name, { recording }]) => [name, hash(assessAnswer(recording))]),
  );
  const field = fixtureA();
  actual['recorded coverage'] = hash({
    assessment: assessAnswer(field, HOST_APP_DECLARATIONS),
    account: accountForAnswer(field, HOST_APP_DECLARATIONS, { runId: FLAGSHIP_RUN_ID }),
  });

  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] },
        { toolCalls: [{ id: 'pause-1', name: 'confirm', args: {} }] },
        { content: 'Port 3 is down.' },
      ],
    }),
    model: 'mock',
  })
    .tools([
      tool('lookup', () =>
        coverage([{ port: 3 }], { checked: ['Switch A'], notChecked: ['Switch B'] }),
      ),
      tool('confirm', () => askHuman({ question: 'Report this lookup?' })),
    ])
    .answerLayer({ standingLine: true })
    .build();
  const assessed: unknown[] = [];
  const delivered: unknown[] = [];
  const stopAssessment = agent.on('agentfootprint.answer.assessed', ({ payload }) =>
    assessed.push(payload),
  );
  const stopDelivery = agent.on('agentfootprint.agent.turn_end', ({ payload }) =>
    delivered.push({ text: payload.finalContent, assessment: payload.answerAssessment }),
  );
  const trace = recordRun(agent);
  try {
    const pending = await agent.run({ message: 'Which ports are down?' });
    expect(isPaused(pending)).toBe(true);
    if (!isPaused(pending)) throw new Error('Expected the mock tool to pause');
    expect(assessed).toHaveLength(0);
    expect(delivered).toHaveLength(0);
    const paused = assessAnswer({ checkpoint: pending.checkpoint });
    expect(paused.standing).toBe('ask');
    actual['waiting on a person'] = hash(paused);

    const answer = await agent.resume(pending.checkpoint, 'yes');
    const saved = JSON.parse(JSON.stringify(trace.toRecording())) as Recording;
    const offline = assessAnswer(saved);
    const live = await agent.assessment();
    expect(assessed).toHaveLength(1);
    expect(delivered).toEqual([{ text: answer, assessment: assessmentDataOf(offline) }]);
    expect(live).toEqual(offline);
    const account = accountForAnswer(saved);
    actual['resumed answer'] = hash({
      answer,
      assessed,
      delivered,
      offline,
      account: {
        standing: account.facts.standing,
        warning: account.facts.limitsBlock,
        howSure: account.rows.find(({ id }) => id === 'how-sure'),
      },
    });
  } finally {
    trace.stop();
    stopAssessment();
    stopDelivery();
  }

  expect(actual).toEqual(before);
});
