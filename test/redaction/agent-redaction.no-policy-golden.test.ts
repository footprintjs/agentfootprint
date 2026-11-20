/**
 * Preserve the historical main stream, with the AF14 migration:
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
 * Occurrence addressing gives each of the four singleton batches one address.
 * The stream uses it on proposals, results, start/end, validation and context
 * injection records. The fixture still pins every other byte.
 *
 * The owning Agent's end also gains `meta.rootTurn`. The Sequence member's
 * end remains unchanged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeCallOccurrences } from '../helpers/normalizeCallOccurrences.js';
import { noPolicyStream } from './noPolicyStream.scenario.js';

describe('no policy preserves the whole stream with native run identity', () => {
  it('matches the historical stream with the named metadata and observation additions', async () => {
    const golden = readFileSync(join(__dirname, 'fixtures/no-policy-stream.main.json'), 'utf8');
    expect(createHash('sha256').update(golden).digest('hex')).toBe(
      '9cb03cd5de896e574fcf35262ec1954205a6c9f1330412565216166f0cd4d241',
    );
    const events = JSON.parse(golden) as {
      type: string;
      payload: Record<string, unknown>;
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
    const calls = {
      c1: { batch: 1, entered: true },
      c2: { batch: 2, entered: false },
      c3: { batch: 3, entered: false },
      c4: { batch: 4, entered: true },
    } as const;
    const callOf = (id: unknown) => {
      expect(typeof id === 'string' && Object.hasOwn(calls, id)).toBe(true);
      return calls[id as keyof typeof calls];
    };
    const occurrenceOf = (id: unknown) => [0, 0, 0, callOf(id).batch, 0];
    const refused = new Set(['c2', 'c3']);
    for (const event of events) {
      const { type, payload } = event;
      if (type === 'agentfootprint.stream.tool_start') {
        const { toolName, toolCallId, ...rest } = payload;
        event.payload = {
          toolName,
          toolCallId,
          callOccurrenceKey: occurrenceOf(toolCallId),
          ...rest,
        };
      } else if (type === 'agentfootprint.stream.tool_end') {
        const { toolCallId, ...rest } = payload;
        event.payload = {
          toolCallId,
          callOccurrenceKey: occurrenceOf(toolCallId),
          ...rest,
          entered: callOf(toolCallId).entered,
        };
      } else if (type === 'agentfootprint.validation.args_invalid') {
        event.payload = { callOccurrenceKey: occurrenceOf(payload.toolCallId), ...payload };
      } else if (type === 'agentfootprint.context.injected' && payload.asRole === 'tool') {
        payload.callOccurrenceKey = occurrenceOf(payload.sourceId);
      } else if (type === 'agentfootprint.agent.iteration_end') {
        const history = (payload.history ?? []) as Record<string, unknown>[];
        for (const message of history) {
          const proposals = (message.toolCalls ?? []) as Record<string, unknown>[];
          for (const proposal of proposals) proposal.callOccurrenceKey = occurrenceOf(proposal.id);
          if (message.role !== 'tool') continue;
          message.callOccurrenceKey = occurrenceOf(message.toolCallId);
          if (refused.has(message.toolCallId as string)) message.outcome = 'refused';
        }
      }
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
    const observed = normalizeCallOccurrences(JSON.parse(await noPolicyStream(true)));
    expect(JSON.stringify(observed, null, 1)).toBe(JSON.stringify(events, null, 1));
  });

  it('pins the whole stream with the default answer assessment', async () => {
    const observed = normalizeCallOccurrences(JSON.parse(await noPolicyStream(false)));
    const stream = JSON.stringify(observed, null, 1);
    expect(createHash('sha256').update(stream).digest('hex')).toBe(
      'fb3434222d5e0ede8e16a2688af261847d20b77867166cb440d1f66b3cc2f46e',
    );
  });
});
