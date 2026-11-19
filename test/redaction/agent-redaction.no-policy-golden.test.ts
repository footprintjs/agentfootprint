/**
 * Preserve the historical main stream, with the one AF14 migration:
 * domain metadata uses the native run ID instead of a second minted ID.
 * One explicit local resource-status event is added, and tool ends gain an
 * `entered` stamp. Every other field, its order and event order remain byte-pinned.
 * The historical fixture is NEVER regenerated from this branch.
 *
 * Second named migration (tool-outcome marker): a committed tool message whose
 * call did not run carries `outcome: 'refused'` as its last field
 * (`semantics/toolOutcome.ts`). In this scenario that is the unknown tool
 * (`c2`) and the call refused for invalid arguments (`c3`), wherever a history
 * carries them.
 *
 * The owning Agent's end also gains `meta.rootTurn`. The Sequence member's
 * end remains unchanged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { noPolicyStream } from './noPolicyStream.scenario.js';

describe('no policy preserves the whole stream with native run identity', () => {
  it('changes only the named native record fields and restoration observation', async () => {
    const golden = readFileSync(join(__dirname, 'fixtures/no-policy-stream.main.json'), 'utf8');
    expect(createHash('sha256').update(golden).digest('hex')).toBe(
      '9cb03cd5de896e574fcf35262ec1954205a6c9f1330412565216166f0cd4d241',
    );
    const events = JSON.parse(golden) as {
      type: string;
      meta: {
        runId: string;
        rootTurn?: true;
        sourcePosition?: { engineRunId?: string; logRunId?: string };
      };
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
    // The fixture ends its resumed Agent first and its Sequence member second.
    const turnEnds = events.filter((event) => event.type === 'agentfootprint.agent.turn_end');
    expect(turnEnds).toHaveLength(2);
    turnEnds[0]!.meta.rootTurn = true;
    // A decided record change: `stream.tool_end` says whether the tool's function was
    // entered (`entered`). The two calls that never reached a tool — an unknown name
    // (`c2`) and rejected arguments (`c3`) — carry `entered: false`. The two
    // successful calls (`c1` and `c4`) carry `entered: true`.
    const entered = { c1: true, c2: false, c3: false, c4: true } as const;
    for (const event of events as unknown as { type: string; payload: Record<string, unknown> }[]) {
      if (event.type !== 'agentfootprint.stream.tool_end') continue;
      const id = event.payload.toolCallId as keyof typeof entered;
      expect(Object.hasOwn(entered, id)).toBe(true);
      event.payload.entered = entered[id];
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
