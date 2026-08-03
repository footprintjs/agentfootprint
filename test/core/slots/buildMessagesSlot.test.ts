/**
 * The messages slot projects the WINDOW, and credits whoever put each
 * message in it.
 *
 * ── What moved, and what the old bug was ─────────────────────────────
 * The slot used to walk `activeInjections` looking for `inject.messages` and
 * append a record per entry — a record for content the request never carried
 * (the 7.19.1 gap), and a record whose reason fallback read `inj.trigger.kind`
 * on a POJO projection that has no `trigger`, so a description-less injection
 * crashed the slot outright.
 *
 * Since 7.21.0 there is no such walk. A delivered injection is IN the window
 * by the time this slot runs, carrying the `injectedBy` marker the delivery
 * stage stamped, so it is projected like any other message and attributed
 * from that marker. This test pins the attribution — including the
 * description-less case the old crash came from, which is exactly the shape
 * the memory-recall bridge produces.
 *
 * Test types (Convention 3): unit (the slot in isolation) / regression.
 */

import { describe, it, expect } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { TypedScope } from 'footprintjs';

import { buildMessagesSlot } from '../../../src/core/slots/buildMessagesSlot.js';
import { SUBFLOW_IDS } from '../../../src/conventions.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import type { InjectionRecord } from '../../../src/recorders/core/types.js';

interface HarnessState {
  [k: string]: unknown;
}

/** Mount the real slot as `sf-messages`, seeded the way the Agent seeds it. */
function harness(history: readonly LLMMessage[]) {
  return flowChart<HarnessState>(
    'Seed',
    (scope: TypedScope<HarnessState>) => {
      scope.iteration = 1;
      scope.history = history;
    },
    'seed',
  )
    .addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, buildMessagesSlot(), 'Messages', {
      inputMapper: (parent: HarnessState) => ({
        messages: parent.history,
        iteration: parent.iteration,
      }),
      outputMapper: (sf: HarnessState) => ({ messagesInjections: sf.messagesInjections }),
    })
    .build();
}

async function project(history: readonly LLMMessage[]): Promise<readonly InjectionRecord[]> {
  const executor = new FlowChartExecutor(harness(history));
  await executor.run({});
  const records = executor.getSnapshot().sharedState.messagesInjections as
    | readonly InjectionRecord[]
    | undefined;
  expect(records).toBeDefined();
  return records!;
}

describe('buildMessagesSlot — one record per message, credited to whoever put it there', () => {
  it('attributes a delivered message to its injection, not to its role', async () => {
    const records = await project([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'last time you asked about refunds',
        injectedBy: {
          injectionId: 'memory:recent',
          flavor: 'memory',
          reason: "recall from memory 'recent'",
          iteration: 1,
        },
      },
    ]);

    // The conversation message by role; the delivered one by its injection.
    expect(records.map((r) => r.source)).toEqual(['user', 'memory']);
    expect(records[1]!.sourceId).toBe('memory:recent');
    expect(records[1]!.reason).toBe("recall from memory 'recent'");
    // Still one record per message — the delivered one is not counted twice.
    expect(records).toHaveLength(2);
  });

  it('falls back to a generated reason when the injection had no description', async () => {
    // The exact shape the memory-recall bridge produces: no `description`, so
    // no `reason` on the marker. The old code reached for `inj.trigger.kind`
    // here and threw `Cannot read properties of undefined (reading 'kind')`.
    const records = await project([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'last time you asked about refunds',
        injectedBy: { injectionId: 'memory:recent', flavor: 'memory', iteration: 3 },
      },
    ]);

    expect(records[1]!.source).toBe('memory');
    expect(records[1]!.reason).toBe("memory 'memory:recent' delivered at iteration 3");
  });

  it('hashes a delivered message the same way an eviction will name it', async () => {
    // The window stage reports `context.evicted` under
    // `${role}:${index}:${content}`. A delivered message has to use the same
    // formula or "injected X" and "evicted X" would name different things.
    const history: readonly LLMMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'a delivered note',
        injectedBy: { injectionId: 'note', flavor: 'fact', iteration: 1 },
      },
    ];
    const records = await project(history);
    const plain = await project([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'a delivered note' },
    ]);
    expect(records[1]!.contentHash).toBe(plain[1]!.contentHash);
  });
});
