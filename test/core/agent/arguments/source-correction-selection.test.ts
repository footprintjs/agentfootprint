import { describe, expect, it } from 'vitest';
import { isPaused } from '../../../../src/index.js';
import { proposal, batch, correctionFixture, argumentsOf } from './sourceCorrectionHarness.js';

const app = (id: string, vm: string) =>
  proposal(id, { vm, _findings: { from: [{ argument: 'vm', source: 'app' }] } });
describe('current native app grounding through selection changes and follow-ups', () => {
  it.each(['dynamic', 'dynamic-grouped'] as const)(
    'uses changed current app data, then preserves it for a follow-up (%s)',
    async (mode) => {
      let selected = 'synthetic-vm-selection-a';
      const f = correctionFixture(
        [
          batch(app('a', selected)),
          'A complete.',
          batch(proposal('b-omitted', { vm: 'synthetic-vm-selection-b' })),
          batch(app('b', 'synthetic-vm-selection-b')),
          'B complete.',
          batch(app('follow-up-b', 'synthetic-vm-selection-b')),
          'B follow-up complete.',
          batch(app('stale-a', 'synthetic-vm-selection-a')),
        ],
        {
          mode,
          configure: {
            externalGrounds: () => [{ value: selected, source: 'current-native-selection' }],
          },
        },
      );
      try {
        expect(await f.agent.run('Read the current selection.')).toBe('A complete.');
        selected = 'synthetic-vm-selection-b';
        expect(await f.agent.followUp('Read the new current selection.')).toBe('B complete.');
        expect(await f.agent.followUp('Give me its inventory.')).toBe('B follow-up complete.');
        expect(f.ran).toEqual([
          { vm: 'synthetic-vm-selection-a' },
          { vm: selected },
          { vm: selected },
        ]);
        expect(argumentsOf(f.agent, 'follow-up-b')[0]).toMatchObject({
          source: 'app',
          appSource: 'current-native-selection',
        });
        expect(isPaused(await f.agent.followUp('Use only the current selection.'))).toBe(true);
        expect(f.ran).toHaveLength(3);
        expect(argumentsOf(f.agent, 'stale-a')[0]).toMatchObject({
          asked: 'unverified',
          claimed: 'app',
          failed: 'not-in-app-text',
        });
      } finally {
        await f.agent.shutdown();
      }
    },
  );
});
