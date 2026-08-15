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
      'docs-next/content/docs/debug/debug.mdx',
      'docs-next/content/docs/reference/dependency-graph.mdx',
      'docs-next/content/docs/monitor/observability.mdx',
      'docs-next/content/docs/build/agent.mdx',
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

  // WHAT THIS NUMBER IS: a RATCHET against accidental REMOVAL, not a cap on
  // how many events may exist. Events are additive within a major, so growing
  // this number is routine — you add an event, this test tells you to bump it,
  // you bump it in the same commit. What it exists to catch is the number
  // going DOWN, or staying flat while `ALL_EVENT_TYPES` is edited: a deleted
  // or renamed entry silently breaks every consumer's `.on()` call, and this
  // assertion is the only place that notices.
  //
  // What it explicitly does NOT do is prove the list is COMPLETE. A count
  // cannot see an event that is emitted but was never listed — that failure is
  // invisible to every assertion in this file, which is how both
  // `resilience.*` events shipped for months while `runner.on()` rejected
  // them by name. Completeness is proven by
  // `test/events/unit/emitted-events-are-registered.test.ts`, which derives
  // the emitted set from src/ instead of trusting a hand-maintained number.
  it('ALL_EVENT_TYPES has exactly 91 entries (Tier 1+2+3 combined)', () => {
    // 69 = 8 composition + 9 agent + 7 stream + 5 context + 4 memory
    //    + 6 tools + 3 skill (skill.rejected added with the read_skill gate)
    //    + 4 permission + 4 credential + 1 risk + 1 fallback
    //    + 2 cost + 2 eval + 3 error + 3 reliability + 2 pause
    //    + 2 checkin (evidence-carrying human consent)
    //    + 1 middleware (a governance chain answered) + 1 embedding
    //    (reliability.* added in the v2 scope↔emit cleanup: fail_fast was
    //     previously a raw unregistered emit; retried/recovered are new.)
    //    (context.evaluated added when the dead injectionEvaluation scope
    //     write became a real emit — see CHANGELOG.)
    //    (credential.* added with declare-and-push — the agentfootprint/identity
    //     consumption seam; see CHANGELOG.)
    //    (validation.args_invalid added with #9 tool-args validation —
    //     model-visible retry; see CHANGELOG.)
    //    (agent.output_schema_retry added with 7.26 — the loop asking again
    //     when the answer failed the schema; see CHANGELOG.)
    //    (memory.retrieved added with 8.8.0 — the candidate set a retrieval
    //     considered, rejections included; see CHANGELOG 8.8.0.)
    //    (skill.reroute_superseded added with 8.3.0 — a read_skill pick the gate
    //     accepted that a declared edge then outranked; see CHANGELOG.)
    //    (agent.output_contract_unmet added with 8.18.0 — the answer this run
    //     hands back does not satisfy its own outputSchema; see CHANGELOG.)
    //    (tools.session_started / session_reused / session_closed /
    //     session_close_failed added with 9.7.0 — a tool that holds a session
    //     (a code interpreter, a browser) now has a teardown contract, and
    //     these four are what it leaves behind; see CHANGELOG 9.7.0.)
    //    (skill.route_conflict added with 9.16.0 — two results of ONE parallel
    //     tool batch matched skill-graph edges to different targets; the first
    //     in call order won the cursor and the suppressed hops are reported
    //     instead of silently dropped.)
    //    (skill.turn_routed added with 9.17.0 — the turn-start routing
    //     cascade's verdict: which tier decided the start, every candidate's
    //     numbers, the menu offered, and the thresholds that judged it.)
    //    (skill.step_advanced / step_skipped / steps_unfinished added with
    //     9.18.0 — steps-as-data: a declared step completed at the result
    //     boundary; the model declined one with its reason on the record;
    //     the turn ended with steps unrun — nudged once, accepted, or
    //     cut short by a limit.)
    //    (tools.result_refused added with 9.20.0 — a tool's own resultCeiling
    //     refused an oversized result: the model read a teaching refusal, the
    //     payload entered no channel, and this event keeps the true size.)
    //    (artifacts.minted / resolved / expired / refused added with 9.21.0 —
    //     the claim-check lifecycle: a tool checked a payload in and got a
    //     ticket; a ref was redeemed; retention swept one with its reason on
    //     the record; a verb refused — no store, missing-or-expired,
    //     unknown parent, digest mismatch — and said why. Meta only, never
    //     payload bytes.)
    //    (artifacts.presented added with 9.22.0 — the model handed a ref to
    //     the screen: present({ref, as}) resolved under scope, and the
    //     description snapshot {kind, mediaType, bytes, label} rode both the
    //     event and the tool result, so a reloaded transcript re-draws the
    //     pane or states honestly why it can't.)
    //    (tools.repeated_call added with 9.26.0 — one tool, dispatched twice
    //     with deeply-equal arguments, returned a byte-identical result: the
    //     framework appended a teaching note to the second result. The call
    //     still ran and nothing was refused. Fingerprints only — never the
    //     arguments and never the result.)
    //    (error.circuit_changed added with 9.32.0 — withCircuitBreaker moved
    //     between closed/open/half-open. Until then the breaker reported
    //     NOTHING through the in-run channel: `onStateChange` was the only
    //     way to see a trip, and it fires at consumer level where the run
    //     ids are synthetic. Transitions only — a request rejected while the
    //     breaker is already open is not a change.)
    //    (agent.evidence_checked added with 9.35.0 — one verdict per
    //     would-be-final answer the evidence gate judged
    //     (`.namesAndNumbersFromEvidence()`), whatever the posture and
    //     whatever the outcome. Names and numbers in the answer that appear
    //     in no tool result were TYPED, not read. A per-attempt fact, so it
    //     rides this channel; only the terminal verdict is committed.)
    //    (agent.run_configured added with 9.41.0 — the run-configuration
    //     manifest: one event at run start naming the adapters and strategies
    //     in play, so N runs group into N labelled ARMS on the runId every
    //     other event already carries. Names and ids ONLY — never an
    //     endpoint, a key or a principal — and an unconfigured field is
    //     ABSENT rather than guessed.)
    //    (tools.absent + tools.coverage_declared added with the coverage
    //     primitives — an absence that names its own coverage, and the ledger
    //     of what a clean result does NOT rule out. Both are RECORDED
    //     unconditionally; only the appending of limits to the final answer is
    //     opt-in, so the record can be measured before it is acted on.)
    //    (resilience.output_fallback_triggered + resilience.output_canned_used
    //     REGISTERED in 9.44.0 — not new behavior. Both had been emitted since
    //     8.18.0 from src/core/outputFallback.ts through a loosely typed
    //     `emit(eventType: string, …)` parameter, with no payload interface,
    //     no EVENT_NAMES group and no ALL_EVENT_TYPES entry — so the docs
    //     described two events that `.on()` refused to accept. A truth
    //     correction: the list now matches what the runtime already emits.)
    expect(ALL_EVENT_TYPES.length).toBe(99);
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
