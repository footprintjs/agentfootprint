import { readFileSync } from 'node:fs';
import type { FlowchartCheckpoint } from 'footprintjs';
import { expect, it, vi } from 'vitest';
import { Agent } from '../../index.js';

it.each(['empty-plain', 'empty-check-in'] as const)(
  'a direct old %s resume explains its unreadable carrier before any provider call',
  async (kind) => {
    const saved = JSON.parse(
      readFileSync(
        new URL(`../../hosting/fixtures/old-pause/${kind}.json`, import.meta.url),
        'utf8',
      ),
    ) as { env: { data: { checkpoint: FlowchartCheckpoint } } };
    const complete = vi.fn(async () => ({
      content: 'done',
      toolCalls: [],
      usage: { input: 1, output: 1 },
    }));
    const agent = Agent.create({ provider: { name: 'scripted', complete }, model: 'test' }).build();
    await expect(agent.resume(saved.env.data.checkpoint, 'yes')).rejects.toThrow(
      'Cannot resume this pause: the saved tool ownership carrier is missing or unreadable. Close this question and start a new run.',
    );
    expect(complete).not.toHaveBeenCalled();
    expect(agent.checkpoint()).toBeUndefined();
    await expect(agent.run('next')).resolves.toBe('done');
  },
);
