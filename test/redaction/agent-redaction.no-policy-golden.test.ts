/**
 * Preserve the historical main stream, with the one AF14 migration:
 * domain metadata uses the native run ID instead of a second minted ID.
 * One explicit local resource-status event is added; original payloads, event order, field order and all other metadata remain byte-pinned.
 * The historical fixture is NEVER regenerated from this branch.
 *
 * Second named migration (tool-outcome marker): a committed tool message whose
 * call did not run carries `outcome: 'refused'` as its last field
 * (`execution/callOutcome.ts`). In this scenario that is the unknown tool
 * (`c2`) and the call refused for invalid arguments (`c3`), wherever a history
 * carries them. Nothing else changes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { noPolicyStream } from './noPolicyStream.scenario.js';

describe('no policy preserves the whole stream with native run identity', () => {
  it('changes only the exact metadata aliases and one named restoration observation', async () => {
    const golden = readFileSync(join(__dirname, 'fixtures/no-policy-stream.main.json'), 'utf8');
    expect(createHash('sha256').update(golden).digest('hex')).toBe(
      '9cb03cd5de896e574fcf35262ec1954205a6c9f1330412565216166f0cd4d241',
    );
    const events = JSON.parse(golden) as {
      meta: { runId: string; sourcePosition?: { engineRunId?: string; logRunId?: string } };
    }[];
    // The first two aliases named one execution, and so on. This fixture's
    // resume is FRESH. SAME resumes retain their original native log identity.
    const aliases: Readonly<Record<string, string>> = {
      'run#1': 'run#1',
      'run#2': 'run#1',
      'run#3': 'run#2',
      'run#4': 'run#2',
      'run#5': 'run#3',
      'run#6': 'run#3',
    };
    const nativeAlias = (value: string): string => {
      if (value === 'consumer-scope') return value;
      expect(Object.hasOwn(aliases, value), value).toBe(true);
      return aliases[value]!;
    };
    for (const event of events) {
      event.meta.runId = nativeAlias(event.meta.runId);
      const source = event.meta.sourcePosition;
      if (source?.engineRunId !== undefined) source.engineRunId = nativeAlias(source.engineRunId);
      if (source?.logRunId !== undefined) source.logRunId = nativeAlias(source.logRunId);
    }
    const refused = new Set(['c2', 'c3']);
    for (const event of events as { payload?: { history?: Record<string, unknown>[] } }[]) {
      for (const m of event.payload?.history ?? [])
        if (m.role === 'tool' && refused.has(m.toolCallId as string)) m.outcome = 'refused';
    }
    (events as unknown[]).splice(73, 0, {
      type: 'agentfootprint.tools.resource_restore',
      payload: { local: 'none-known-locally', remote: 'unknown' },
      meta: {
        wallClockMs: '<n>',
        runOffsetMs: '<n>',
        runtimeStageId: 'tool-teardown#0',
        subflowPath: [],
        compositionPath: ['Agent:agent'],
        runId: 'run#2',
      },
    });
    expect(await noPolicyStream()).toBe(JSON.stringify(events, null, 1));
  });
});
