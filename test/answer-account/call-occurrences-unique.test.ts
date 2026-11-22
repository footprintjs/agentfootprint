import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  absent,
  Agent,
  coverage,
  defineTool,
  isInputPause,
  requestInput,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

/** Complete account, returned answer and assessments from f44f95bcb7c5, in seed order. */
const BASELINE: readonly string[] = [
  '793bdc1ca20dd996035e1f328abf3c3e3b745e59ab60b408688fb66b52acb74a',
  'b741fc4b2238bc2d7db6f7bb0b1f96a0584611afe97f2c8eb9dee87bf08e9172',
  'df884dfe0c827c7c9c8d76933f6cd1ca95b5f753c4df0a718b244c4a2b07e25a',
  '70aca38fc8ab5fd5592fba574d538c033559645563ab7bff6c8d0812bee4b36c',
  '1d566b514e5b58b8f570bdeefa6bb0d6c5ad1a3cf5f6c05151ba3488c7135464',
  '3870c1903775cfe4b3c667f77abf2bdefc7d5a99956468f04f558c0bc79d4a47',
  'bf7c46018fea5a8476df895c0d463deec87ff28bdf2d4d304054c8930d6eb857',
  '13f294ee1a291de5f6a1ffd2c9c24262db425d9d4e9eb97f87a0168b8f5faab2',
  '760ed55db730942c4a581975ff02012a71509ff007499b4cb60132ab00ea3077',
  '1d7330fa2c22f5c2b421d27547c02855ba3fd1e3692660ef3983121874652c42',
  '67eab1f9976f8148e2aa003152b2e32e436f3b34bdd089fa1deb7468d63db420',
  '84adb107bd34829a64c396a78c81c9eb3a89d39105741e8f4a2577213260121a',
  '6eef68f7498d2d66536586a597b052df8184db143d3da66024b2760cc5de88cd',
  'e0ff32a1925679f150833f9f1f086da5c0117b36b1f6f9bfbf45d56fc2254316',
  '76cbb418da1bbb9e7c4b16d358f26b3ff19d9008ddec9b57500d38bd56bf900a',
  '9c5a0828996b7852ba56c082fe4ed5014783501c972ad60093011400419b01e7',
  'beaa9dd6e6c56cc494c67bdae058474f47e7f3a91793877e0b1a8249aae77bdc',
  '4850dfe40a951da1f566e09022eec373adc92758802d12b9ed0337ee90973f62',
  'de5cff9c40e06e40619edbb63683f1e3977ae5fcad45fd06ba8ddf644d2d0873',
  'a7ef02339f73e9b201e1a03d27ad62849d64b1cac99796ba655bee749d392335',
];

// The four pause fixtures now report that the settled sibling did not run.
// Its proposed input and synthetic result no longer count as tool evidence.
const SETTLED_SIBLING_BASELINE: Readonly<Partial<Record<number, string>>> = {
  4: '59f453f39f7a28b7fbb47d30bf59941b07191a1b5493d3fd46e111ffdbe8ddeb',
  9: 'a1f81f90db44da0b1830d3d9f3297d1728173b29a12683e8ddbb508def3fc3d1',
  14: '4dbc4d9dcfcf3423702f45c31d1ad0f6f8ff6c19bc55ecebafea194f7531dcae',
  19: '075376244a947cfed3a4298dabbea8bd73d7b002471d7a7663ceaaec0cc26726',
};
const SEEDS = Array.from({ length: 20 }, (_, seed) => seed);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T14:08:49Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const TOOLS = ['inventory', 'review'] as const;
const RESULTS = ['rows', 'empty', 'absence', 'coverage', 'partial', 'pending', 'failure'] as const;
const CHECKED = ['the selected inventory'];
const GAP = ['items awaiting import'];

function resultFor(slot: number) {
  switch (RESULTS[slot]) {
    case 'rows':
      return [{ available: true }];
    case 'empty':
      return [];
    case 'absence':
      return absent({ what: 'the inventory item', checked: CHECKED, notChecked: GAP });
    case 'coverage':
      return coverage([{ available: true }], { checked: CHECKED, notChecked: GAP });
    case 'partial':
      return { content: 'Some items are ready.', effects: [], status: 'partial' as const };
    case 'pending':
      return {
        content: 'Items are still being imported.',
        effects: [],
        status: 'pending' as const,
      };
    case 'failure':
      throw new Error('The inventory is temporarily unavailable.');
    default:
      throw new Error('Unexpected generated tool argument.');
  }
}

function generatedRun(seed: number) {
  let random = seed + 1;
  const pick = (limit: number) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return (random >>> 8) % limit;
  };
  let nextId = 0;
  const call = (name: string, args: Record<string, unknown> = {}) => ({
    id: `request-${seed}-${++nextId}`,
    name,
    args,
  });
  const batches = (count: number) =>
    Array.from({ length: count }, () => ({
      toolCalls: Array.from({ length: 1 + pick(3) }, () =>
        call(TOOLS[pick(TOOLS.length)]!, { slot: seed === 1 ? 0 : pick(RESULTS.length) }),
      ),
    }));
  const first = batches(seed === 0 ? 0 : 1 + pick(3));
  const followUp = seed % 5 === 3;
  const pauses = seed % 5 === 4;
  const requiresWindow = seed % 4 !== 1;
  if (pauses) {
    first.push({ toolCalls: [call('ask_year'), call('inventory', { slot: 0 })] });
  }
  const agent = Agent.create({
    provider: mock({
      replies: [
        ...first,
        { content: 'Inventory reviewed.' },
        ...(followUp ? [...batches(1 + pick(2)), { content: 'Additional review complete.' }] : []),
      ],
    }),
    model: 'mock',
  })
    .tools(
      TOOLS.map((name) =>
        defineTool({
          name,
          displayName: name === 'inventory' ? 'the inventory check' : 'the review',
          description: 'Read one inventory fixture.',
          inputSchema: {
            type: 'object',
            properties: { slot: { type: 'integer' }, window: { type: 'string' } },
            required: requiresWindow ? ['slot', 'window'] : ['slot'],
          },
          ...(requiresWindow && { askOrAssume: { window: { assume: '2h' } } }),
          execute: ({ slot }: { slot: number }) => resultFor(slot),
        }),
      ),
    )
    .tool(
      defineTool({
        name: 'ask_year',
        description: 'Collect the inventory year.',
        inputSchema: { type: 'object' },
        execute: () =>
          requestInput({
            id: 'year',
            question: 'Which year?',
            fields: [{ id: 'year', type: 'number', required: true }],
          }),
      }),
    )
    .inputsLayer()
    .answerLayer({ standingLine: true })
    .build();
  return { agent, followUp, pauses };
}

function digest(value: unknown, runs: ReadonlyMap<string, string>): string {
  // Sort object keys and retain every array position and value. The run id has a
  // process-wide sequence, so use ordinals from the input recording's events.
  // An id selected from the wrong leg gives a different ordinal or is left raw.
  // Provider ids, history and event indexes, and runtime stage ids stay intact.
  const canonical = JSON.stringify(value, (key, entry: unknown) => {
    if (key === 'runId' && typeof entry === 'string') return runs.get(entry) ?? entry;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    return Object.fromEntries(
      Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : Number(left > right))),
    );
  });
  return createHash('sha256').update(canonical).digest('hex');
}

it.each(SEEDS)(
  'preserves the complete account and standing for unique call IDs, seed %i',
  async (seed) => {
    const { agent, followUp, pauses } = generatedRun(seed);
    const captures: unknown[] = [];
    const runs = new Map<string, string>();
    const capture = async (run: () => ReturnType<typeof agent.run>) => {
      const recorder = recordRun(agent);
      try {
        const result = await run();
        const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
        for (const { meta } of recording.events) {
          if (!runs.has(meta.runId)) runs.set(meta.runId, `recorded-run-${runs.size + 1}`);
        }
        const account = accountForAnswer(recording);
        // New templates advance the vocabulary for unmatched evidence and withheld results.
        // Compare every old sentence and pointer against the pinned version-18 account.
        expect(account.templates).toEqual({ set: 'answer-account', version: 23 });
        captures.push({
          account: { ...account, templates: { ...account.templates, version: 18 } },
          answer: typeof result === 'string' ? result : 'paused',
          recordedAssessment: assessAnswer(recording),
          liveAssessment: await agent.assessment(),
        });
        return result;
      } finally {
        recorder.stop();
      }
    };
    const result = await capture(() => agent.run({ message: 'Review the inventory.' }));
    if (pauses) {
      if (!isInputPause(result)) throw new Error('Expected the generated input pause.');
      await capture(() =>
        agent.resume(result.checkpoint, {
          requestId: result.awaitingInput.requestId,
          values: { year: 2026 },
        }),
      );
    }
    if (followUp) await capture(() => agent.followUp('Review the next inventory.'));
    expect(digest(captures, runs)).toBe(SETTLED_SIBLING_BASELINE[seed] ?? BASELINE[seed]);
  },
);
