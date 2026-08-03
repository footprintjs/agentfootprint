/**
 * Regression — a messages-slot ACTIVE injection without a `description` must
 * not crash buildMessagesSlot.
 *
 * The bug: `activeInjections` holds `ActiveInjection` POJOs (projected — NO
 * `trigger` field), but the reason fallback read `inj.trigger.kind`:
 *     reason: inj.description ?? `… (trigger: ${inj.trigger.kind})`
 * When a messages-targeted injection had no `description`, the `??` fallback
 * evaluated `inj.trigger.kind` → `TypeError: Cannot read properties of
 * undefined (reading 'kind')` inside the sf-messages slot.
 *
 * It used to be reachable as `.fact(defineFact({ slot: 'messages' }))`. Since
 * 7.19.1 that declaration is refused (see messagesSlotRefusal.test.ts) — the
 * slot never delivered it — so the surviving producer is the internal
 * memory-recall bridge, which hands the slot exactly this shape: an
 * ActiveInjection with `inject.messages` and no `description`. The slot is
 * therefore driven directly here with that POJO, rather than through an agent
 * that can no longer be built this way.
 *
 * Test types (Convention 3): unit (the slot in isolation) / regression.
 */

import { describe, it, expect } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { TypedScope } from 'footprintjs';

import { buildMessagesSlot } from '../../../src/core/slots/buildMessagesSlot.js';
import { SUBFLOW_IDS } from '../../../src/conventions.js';
import type { ActiveInjection } from '../../../src/lib/injection-engine/types.js';
import type { InjectionRecord } from '../../../src/recorders/core/types.js';

interface HarnessState {
  [k: string]: unknown;
}

/** Mount the real slot as `sf-messages`, seeded the way the Agent seeds it. */
function harness(activeInjections: readonly ActiveInjection[]) {
  return flowChart<HarnessState>(
    'Seed',
    (scope: TypedScope<HarnessState>) => {
      scope.iteration = 1;
      scope.history = [{ role: 'user', content: 'hi' }];
      scope.activeInjections = activeInjections;
    },
    'seed',
  )
    .addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, buildMessagesSlot(), 'Messages', {
      inputMapper: (parent: HarnessState) => ({
        messages: parent.history,
        iteration: parent.iteration,
        activeInjections: parent.activeInjections,
      }),
      outputMapper: (sf: HarnessState) => ({ messagesInjections: sf.messagesInjections }),
    })
    .build();
}

describe('buildMessagesSlot — messages-slot active injection without a description', () => {
  it('does not throw; the record falls back to a generated reason', async () => {
    // The exact POJO the memory-recall bridge produces: no `trigger` (the
    // projection drops it) and no `description`.
    const recall: ActiveInjection = {
      id: 'memory:recent',
      flavor: 'memory',
      inject: { messages: [{ role: 'user', content: 'last time you asked about refunds' }] },
    };

    const executor = new FlowChartExecutor(harness([recall]));
    // Previously rejected with "Cannot read properties of undefined (reading
    // 'kind')" raised inside sf-messages. Must resolve normally.
    await executor.run({});

    const records = executor.getSnapshot().sharedState.messagesInjections as
      | readonly InjectionRecord[]
      | undefined;
    expect(records).toBeDefined();
    // The conversation message, then the injection-derived one.
    expect(records!.map((r) => r.source)).toEqual(['user', 'memory']);
    expect(records![1]!.reason).toBe("memory 'memory:recent' active");
  });
});
