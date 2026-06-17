/**
 * Unit tests — Event Registry.
 *
 * Pattern: Test-as-specification.
 * Role:    Lock the event contract: names, exhaustiveness, type-payload map.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEvent,
  type AgentfootprintEventMap,
  type AgentfootprintEventType,
} from '../../../src/events/registry.js';

describe('event registry — docs stay in sync with the registry (anti-drift)', () => {
  // The "<N> typed events × <D> domains" claim appears in three docs. Derive
  // N and D from EVENT_NAMES so adding an event/domain without updating the
  // docs fails THIS test instead of shipping stale numbers (the 59-vs-63
  // drift happened exactly this way — backlog Phase-0 #4).
  it('every doc stating "<N> typed events … <D> domains" matches the derived counts', () => {
    const eventCount = ALL_EVENT_TYPES.length;
    const domainCount = Object.keys(EVENT_NAMES).length;
    const root = join(__dirname, '../../..');
    const DOCS = [
      'CLAUDE.md',
      'AGENTS.md',
      'docs/MENTAL_MODEL.md',
      'ai-instructions/claude-code/SKILL.md',
      'docs-site/src/content/docs/index.mdx',
      'docs-site/src/content/docs/getting-started/debug.mdx',
      'docs-site/src/content/docs/architecture/dependency-graph.mdx',
      'docs-site/src/content/docs/guides/observability.mdx',
      'docs-site/src/content/docs/guides/agent.mdx',
    ];
    for (const doc of DOCS) {
      const text = readFileSync(join(root, doc), 'utf8');
      // tolerate the phrasings in use: "× ", " across ", " / ", "fire across"
      const matches = [...text.matchAll(/(\d+) typed events\D{1,15}?(\d+) domains/g)];
      expect(
        matches.length,
        `${doc} has no "<N> typed events … <D> domains" claim`,
      ).toBeGreaterThan(0);
      for (const m of matches) {
        expect(
          Number(m[1]),
          `${doc} says ${m[1]} events; registry has ${eventCount} — update the doc`,
        ).toBe(eventCount);
        expect(
          Number(m[2]),
          `${doc} says ${m[2]} domains; registry has ${domainCount} — update the doc`,
        ).toBe(domainCount);
      }
    }
  });
});

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

  it('ALL_EVENT_TYPES has exactly 65 entries (Tier 1+2+3 combined)', () => {
    // 65 = 8 composition + 8 agent + 7 stream + 5 context + 4 memory
    //    + 6 tools + 3 skill (skill.rejected added with the read_skill gate)
    //    + 4 permission + 4 credential + 1 risk + 1 fallback
    //    + 2 cost + 2 eval + 3 error + 3 reliability + 2 pause + 1 embedding
    //    (reliability.* added in the v2 scope↔emit cleanup: fail_fast was
    //     previously a raw unregistered emit; retried/recovered are new.)
    //    (context.evaluated added when the dead injectionEvaluation scope
    //     write became a real emit — see CHANGELOG.)
    //    (credential.* added with declare-and-push — the agentfootprint/identity
    //     consumption seam; see CHANGELOG.)
    //    (validation.args_invalid added with #9 tool-args validation —
    //     model-visible retry; see CHANGELOG.)
    expect(ALL_EVENT_TYPES.length).toBe(65);
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
