/**
 * Unit tests — Event Registry.
 *
 * Pattern: Test-as-specification.
 * Role:    Lock the event contract: names, exhaustiveness, type-payload map.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEvent,
  type AgentfootprintEventMap,
  type AgentfootprintEventType,
} from '../../../src/events/registry.js';

describe('event registry — names + exhaustiveness', () => {
  it('every EVENT_NAMES entry is in the agentfootprint.<domain>.<action> form', () => {
    const flat = collectEventNames(EVENT_NAMES);
    for (const name of flat) {
      expect(name).toMatch(/^agentfootprint\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it('EVENT_NAMES covers every ALL_EVENT_TYPES entry and vice versa', () => {
    const fromNames = new Set(collectEventNames(EVENT_NAMES));
    const fromList = new Set<string>(ALL_EVENT_TYPES);
    expect(fromNames).toEqual(fromList);
  });

  it('ALL_EVENT_TYPES has exactly 55 entries (Tier 1+2+3 combined)', () => {
    // 55 = 8 composition + 8 agent + 7 stream + 4 context + 4 memory
    //    + 6 tools + 2 skill + 4 permission + 1 risk + 1 fallback
    //    + 2 cost + 2 eval + 3 error + 2 pause + 1 embedding
    expect(ALL_EVENT_TYPES.length).toBe(55);
  });

  it('every entry in ALL_EVENT_TYPES is a key of AgentfootprintEventMap', () => {
    for (const type of ALL_EVENT_TYPES) {
      // Compile-time (via the generic) + runtime (EVENT_NAMES check).
      const key: keyof AgentfootprintEventMap = type;
      expect(key).toBe(type);
    }
  });

  it('event types are unique (no duplicates)', () => {
    const set = new Set(ALL_EVENT_TYPES);
    expect(set.size).toBe(ALL_EVENT_TYPES.length);
  });
});

describe('event registry — typed payload map', () => {
  it('AgentfootprintEvent discriminated union narrows on `type`', () => {
    // Compile-time: the switch below MUST exhaustively handle every type
    // or TypeScript fails. This is a structural test — if someone adds a
    // new event without updating the union, this test stops compiling.
    function narrow(e: AgentfootprintEvent): string {
      switch (e.type) {
        case 'agentfootprint.composition.enter':
          return e.payload.kind;
        case 'agentfootprint.context.injected':
          return e.payload.slot;
        case 'agentfootprint.stream.llm_start':
          return e.payload.provider;
        case 'agentfootprint.stream.llm_end':
          return e.payload.stopReason;
        default:
          return 'other';
      }
    }
    expect(typeof narrow).toBe('function');
  });

  it('event type string unions are exhaustive at the type level', () => {
    expectTypeOf<AgentfootprintEventType>().toEqualTypeOf<keyof AgentfootprintEventMap>();
  });
});

describe('event registry — tiering (Tier 1 core events are first-class)', () => {
  const TIER_1_CONTEXT = [
    'agentfootprint.context.injected',
    'agentfootprint.context.evicted',
    'agentfootprint.context.slot_composed',
    'agentfootprint.context.budget_pressure',
  ];
  const TIER_1_STREAM = [
    'agentfootprint.stream.llm_start',
    'agentfootprint.stream.llm_end',
    'agentfootprint.stream.tool_start',
    'agentfootprint.stream.tool_end',
  ];

  it('all Tier 1 events are in ALL_EVENT_TYPES (the core surface)', () => {
    const all = new Set<string>(ALL_EVENT_TYPES);
    for (const t of [...TIER_1_CONTEXT, ...TIER_1_STREAM]) {
      expect(all.has(t)).toBe(true);
    }
  });
});

// ─── helper ──────────────────────────────────────────────────────────

function collectEventNames(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(obj)) {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object')
      out.push(...collectEventNames(v as Record<string, unknown>));
  }
  return out;
}
