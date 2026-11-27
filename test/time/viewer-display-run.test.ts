import { expect, it } from 'vitest';
import { Agent, InvalidRunInputError, type AgentInput } from '../../src/index.js';
import { fixture, input, args, LA, NY } from './fixtures/viewerDisplay.js';

it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
  '%s records one display-only zone without changing actual tool arguments',
  async (mode) => {
    const { agent, requests, calls } = fixture(mode);
    try {
      const answer = await agent.run(input({ viewerZone: NY }));
      expect(agent.findings()).toContainEqual(
        expect.objectContaining({
          kind: 'clock',
          zone: LA,
          display: { purpose: 'display-only', viewerZone: NY },
        }),
      );
      expect(calls).toEqual([args]);
      expect(JSON.stringify(requests)).toContain('viewer display:');
      expect(JSON.stringify(requests)).toContain('06:00');
      expect(String(answer)).toContain('viewer display:');
    } finally {
      await agent.shutdown();
    }
  },
);

it.each(
  [
    null,
    {},
    { viewerZone: 'PST' },
    { viewerZone: '+05:30' },
    { viewerZone: 'No/SuchZone' },
    { viewerZone: NY, zone: LA },
    { viewerZone: 123 },
    [],
  ].map((display) => ({ display })),
)('refuses malformed display $display before calling the provider', async ({ display }) => {
  const { agent, requests, calls } = fixture();
  try {
    await expect(agent.run(input(display))).rejects.toBeInstanceOf(InvalidRunInputError);
    expect(requests).toHaveLength(0);
    expect(calls).toHaveLength(0);
  } finally {
    await agent.shutdown();
  }
});

it('does not invoke a viewerZone accessor or enter the model', async () => {
  let reads = 0;
  const display = Object.defineProperty({}, 'viewerZone', {
    enumerable: true,
    get() {
      reads++;
      return NY;
    },
  });
  const { agent, requests } = fixture();
  try {
    await expect(agent.run(input(display))).rejects.toBeInstanceOf(InvalidRunInputError);
    expect(reads).toBe(0);
    expect(requests).toHaveLength(0);
  } finally {
    await agent.shutdown();
  }
});

it('requires an armed time layer for the separate display input', async () => {
  const { agent, requests } = fixture('dynamic', false);
  try {
    await expect(
      agent.run({ message: 'Read.', timeDisplay: { viewerZone: NY } } as AgentInput),
    ).rejects.toBeInstanceOf(InvalidRunInputError);
    expect(requests).toHaveLength(0);
  } finally {
    await agent.shutdown();
  }
});

it('leaves the ordinary clock row free of display metadata', async () => {
  const { agent } = fixture();
  try {
    await agent.run(input());
    const clock = agent.findings()?.find((row) => row.kind === 'clock');
    expect(clock).toBeDefined();
    expect(clock).not.toHaveProperty('display');
  } finally {
    await agent.shutdown();
  }
});

it('uses the same admission before a typed run reaches its provider', async () => {
  let requests = 0;
  const agent = Agent.create({
    model: 'mock',
    provider: {
      name: 'typed-display',
      async complete() {
        requests++;
        return { content: '{}', toolCalls: [], usage: { input: 0, output: 0 } };
      },
    },
  })
    .time()
    .outputSchema({ parse: (value) => value })
    .build();
  try {
    await expect(
      agent.runTyped({ message: 'Read.', timeDisplay: { viewerZone: 'PST' } }),
    ).rejects.toThrow(/timeDisplay/);
    expect(requests).toBe(0);
  } finally {
    await agent.shutdown();
  }
});

it('keeps separate viewers on independent agents', async () => {
  const first = fixture(),
    second = fixture();
  try {
    await Promise.all([
      first.agent.run(input({ viewerZone: NY })),
      second.agent.run(input({ viewerZone: 'Asia/Kathmandu' })),
    ]);
    expect(JSON.stringify(first.requests)).toContain('America/New_York');
    expect(JSON.stringify(first.requests)).not.toContain('Asia/Kathmandu');
    expect(JSON.stringify(second.requests)).toContain('Asia/Kathmandu');
    expect(JSON.stringify(second.requests)).not.toContain('America/New_York');
  } finally {
    await first.agent.shutdown();
    await second.agent.shutdown();
  }
});
