import { expect, it, vi } from 'vitest';
import { validateCheckpoint } from '../../src/core/runCheckpoint.js';
import { fixture, input } from './fixtures/viewerDisplay.js';
import wire from './fixtures/viewer-display-pre-feature-wire.json';
import older from './fixtures/viewer-display-released-checkpoint.json';

it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
  'keeps feature-off %s requests, events and answers byte-identical to pre-feature main',
  async (mode) => {
    let id = 0;
    const clocks = [
      vi.spyOn(Date, 'now').mockReturnValue(1794578400000),
      vi.spyOn(Math, 'random').mockReturnValue(0.125),
      vi.spyOn(performance, 'now').mockReturnValue(1234),
      vi
        .spyOn(globalThis.crypto, 'randomUUID')
        .mockImplementation(
          () =>
            `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` as ReturnType<
              Crypto['randomUUID']
            >,
        ),
      vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
        if (array instanceof Uint32Array) array.fill(17);
        return array;
      }),
    ];
    const f = fixture(mode);
    const events: unknown[] = [];
    f.agent.on('*', (event) => events.push(JSON.parse(JSON.stringify(event))));
    try {
      const answer = await f.agent.run(input());
      const actual = {
        requests: f.requests,
        calls: f.calls,
        answer,
        clock: f.agent.findings()?.filter((row) => row.kind === 'clock'),
        events,
      };
      await f.agent.shutdown();
      // Whole messages and event envelopes: no omitted-field normalizer.
      expect(JSON.stringify(actual)).toBe(JSON.stringify(wire[mode]));
    } finally {
      await f.agent.shutdown();
      for (const clock of clocks) clock.mockRestore();
    }
  },
);

it('reads and continues a checkpoint produced by the released reader', async () => {
  expect(() => validateCheckpoint(older)).not.toThrow();
  const f = fixture('dynamic', true, { resume: true });
  try {
    await f.agent.run({ ...input(), continueFrom: older });
    expect(f.calls).toEqual([]);
    expect(
      f.agent
        .findings()
        ?.filter((row) => row.kind === 'clock')
        .every((row) => !Object.hasOwn(row, 'display')),
    ).toBe(true);
    expect(JSON.stringify(f.requests)).not.toContain('viewer display:');
  } finally {
    await f.agent.shutdown();
  }
});
