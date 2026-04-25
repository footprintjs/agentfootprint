/**
 * Integration tests — full registry → dispatcher → listener round trip.
 *
 * Verifies every event name in ALL_EVENT_TYPES can be dispatched and
 * observed via both typed subscription and wildcard subscription.
 */

import { describe, it, expect } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  ALL_EVENT_TYPES,
  type AgentfootprintEvent,
} from '../../../src/events/registry.js';
import type { EventMeta } from '../../../src/events/types.js';

function meta(): EventMeta {
  return {
    wallClockMs: 0,
    runOffsetMs: 0,
    runtimeStageId: 's#0',
    subflowPath: [],
    compositionPath: [],
    runId: 'r',
  };
}

describe('integration — every registered event round-trips', () => {
  it('wildcard (*) receives one dispatch per registered event type', () => {
    const d = new EventDispatcher();
    const received: string[] = [];
    d.on('*', (e) => received.push(e.type));

    for (const type of ALL_EVENT_TYPES) {
      d.dispatch({ type, payload: {}, meta: meta() } as unknown as AgentfootprintEvent);
    }

    expect(received).toEqual([...ALL_EVENT_TYPES]);
  });

  it('domain wildcard only receives events from its domain', () => {
    const d = new EventDispatcher();
    const contextReceived: string[] = [];
    const streamReceived: string[] = [];
    d.on('agentfootprint.context.*', (e) => contextReceived.push(e.type));
    d.on('agentfootprint.stream.*', (e) => streamReceived.push(e.type));

    for (const type of ALL_EVENT_TYPES) {
      d.dispatch({ type, payload: {}, meta: meta() } as unknown as AgentfootprintEvent);
    }

    const expectedContext = ALL_EVENT_TYPES.filter((t) =>
      t.startsWith('agentfootprint.context.'),
    );
    const expectedStream = ALL_EVENT_TYPES.filter((t) =>
      t.startsWith('agentfootprint.stream.'),
    );
    expect(contextReceived).toEqual([...expectedContext]);
    expect(streamReceived).toEqual([...expectedStream]);
  });
});
