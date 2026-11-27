import { expect, it } from 'vitest';
import { isPaused, isInputPause, RunCheckpointError, type AgentInput } from '../../src/index.js';
import { TIME_LINE_SOURCE } from '../../src/core/agent/arguments/serve.js';
import { fixture, input, args, LA, NY } from './fixtures/viewerDisplay.js';

it.each(['dynamic', 'dynamic-grouped'] as const)(
  'keeps %s display across a JSON pause on a fresh agent',
  async (mode) => {
    const first = fixture(mode, true, { pause: true });
    const resumed = fixture(mode, true, { resume: true });
    try {
      const stopped = await first.agent.run(input({ viewerZone: NY }));
      if (!isPaused(stopped)) throw Error('expected native pause');
      const checkpoint = JSON.parse(JSON.stringify(stopped.checkpoint));
      const original = first.agent.findings()?.filter((row) => row.kind === 'clock');
      await resumed.agent.resume(checkpoint, 'yes', {
        time: { now: '2026-11-13T15:00:00Z', zone: 'Europe/London' },
      });
      expect(resumed.agent.findings()?.filter((row) => row.kind === 'clock')).toEqual(original);
      expect(JSON.stringify(resumed.requests)).toContain('viewer display:');
      expect(resumed.calls).toEqual([]);
    } finally {
      await first.agent.shutdown();
      await resumed.agent.shutdown();
    }
  },
);

it('does not inherit viewer display into a continued new question', async () => {
  const previous = fixture();
  const next = fixture('dynamic', true, { resume: true });
  try {
    await previous.agent.run(input({ viewerZone: NY }));
    const cp = JSON.parse(JSON.stringify(previous.agent.checkpoint()));
    await next.agent.run({ ...input(), continueFrom: cp });
    const clocks = next.agent.findings()?.filter((row) => row.kind === 'clock') ?? [];
    expect(clocks).toHaveLength(2);
    expect(clocks[0]).toHaveProperty('display.viewerZone', NY);
    expect(clocks[1]).not.toHaveProperty('display');
    const note = next.requests[0]?.messages.filter(
      (message) => message.role === 'user' && message.content.startsWith(TIME_LINE_SOURCE),
    );
    expect(note).toHaveLength(1);
    expect(JSON.stringify(note)).not.toContain('viewer display:');
    expect(
      next.requests[0]?.messages.some(
        (message) => message.role === 'assistant' && message.content.includes('viewer display:'),
      ),
    ).toBe(true);
  } finally {
    await previous.agent.shutdown();
    await next.agent.shutdown();
  }
});

it('allows only the intended display labels to change actual model request bytes', async () => {
  const plain = fixture(),
    displayed = fixture();
  try {
    const plainAnswer = await plain.agent.run(input());
    const shownAnswer = await displayed.agent.run(input({ viewerZone: NY }));
    const suffixes = [
      ' (viewer display: 2026-11-13 06:00–08:00 America/New_York (UTC-05:00))',
      ' (viewer display: 2026-11-13 06:00–08:00 America/New_York (UTC-05:00) (end excluded))',
      ' (viewer display: 2026-11-13 06:00:00.000–08:00:00.001 America/New_York (UTC-05:00) (end excluded))',
      ' (viewer display: 2026-11-13 09:00 America/New_York (UTC-05:00))',
    ];
    const withoutDisplay = (value: string) =>
      suffixes.reduce((text, suffix) => text.split(suffix).join(''), value);
    expect(withoutDisplay(JSON.stringify(displayed.requests))).toBe(JSON.stringify(plain.requests));
    expect(displayed.calls).toEqual(plain.calls);
    expect(displayed.calls).toEqual([args]);
    // This scripted provider ignores labels; no real-model behavior claim follows.
    expect(withoutDisplay(String(shownAnswer))).toBe(plainAnswer);
  } finally {
    await plain.agent.shutdown();
    await displayed.agent.shutdown();
  }
});

it('shows viewer labels on confirmation without changing its offered values', async () => {
  const ordinary = fixture('dynamic', true, { reader: true, missingArgs: true });
  const displayed = fixture('dynamic', true, { reader: true, missingArgs: true });
  const question = {
    message: 'Read November 13, 2026 from 3 AM to 5 AM.',
    time: { now: '2026-11-13T14:00:00Z', zone: LA },
  };
  try {
    const a = await ordinary.agent.run(question);
    const b = await displayed.agent.run({
      ...question,
      timeDisplay: { viewerZone: NY },
    } as AgentInput);
    if (!isInputPause(a) || !isInputPause(b)) throw Error('expected time confirmation');
    const af = a.awaitingInput?.fields.find((field) => field.format === 'time-range');
    const bf = b.awaitingInput?.fields.find((field) => field.format === 'time-range');
    expect(bf?.enum).toEqual(af?.enum);
    expect(JSON.stringify(bf?.labels)).toContain('viewer display:');
    expect(ordinary.calls).toEqual([]);
    expect(displayed.calls).toEqual([]);
  } finally {
    await ordinary.agent.shutdown();
    await displayed.agent.shutdown();
  }
});

it('does not use a known viewer zone as the missing interpretation zone', async () => {
  const { agent } = fixture('dynamic', true, {
    reader: true,
    missingArgs: true,
    unknownZone: true,
  });
  try {
    const result = await agent.run({
      message: 'Read yesterday.',
      time: { now: '2026-11-13T14:00:00Z' },
      timeDisplay: { viewerZone: NY },
    } as AgentInput);
    expect(agent.findings()).toContainEqual(
      expect.objectContaining({ kind: 'clock', zoneSource: 'unknown' }),
    );
    if (!isInputPause(result)) throw Error('expected unknown-zone question');
    expect(result.awaitingInput?.fields.some((field) => field.format === 'zone')).toBe(true);
  } finally {
    await agent.shutdown();
  }
});

it('retains display from the sole clock record across a real error checkpoint', async () => {
  const failed = fixture('dynamic', true, { failAfterTool: true });
  const recovered = fixture('dynamic', true, { resume: true });
  try {
    let checkpoint: unknown;
    try {
      await failed.agent.run(input({ viewerZone: NY }));
    } catch (error) {
      if (!(error instanceof RunCheckpointError)) throw error;
      checkpoint = JSON.parse(JSON.stringify(error.checkpoint));
    }
    expect(checkpoint).toBeDefined();
    const clocks = failed.agent.findings()?.filter((row) => row.kind === 'clock');
    await recovered.agent.resumeOnError(checkpoint, {
      time: { now: '2026-11-14T00:00:00Z', zone: 'UTC' },
    });
    const after = recovered.agent.findings()?.filter((row) => row.kind === 'clock') ?? [];
    expect(after[0]).toEqual(clocks?.[0]);
    expect(after.filter((row) => Object.hasOwn(row, 'display'))).toHaveLength(1);
    // Error replay's existing clock policy is unchanged, unlike native pause.
    expect(after[1]).toMatchObject({ turn: 1, zone: 'UTC', now: '2026-11-14T00:00:00Z' });
    expect(JSON.stringify(recovered.requests)).toContain('viewer display:');
    expect(recovered.calls).toEqual([]);
  } finally {
    await failed.agent.shutdown();
    await recovered.agent.shutdown();
  }
});
