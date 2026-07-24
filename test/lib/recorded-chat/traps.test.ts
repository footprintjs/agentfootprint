/**
 * The three named traps recordedChat owns (vr7-spec Part 2), as regression
 * tests + the mandated byte-exact history test. Each is the exact silent
 * failure the hand-rolled glue invites; recordedChat makes it structural.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LLMRequest } from '../../../src/adapters/types';
import { recordedChat } from '../../../src/lib/recorded-chat';
import type { AblationSpec } from '../../../src/lib/context-bisect';
import { chatDeskFixture, scriptedRespond, REPLY } from './chatDeskFixture';

vi.setConfig({ testTimeout: 30000 });

const T1 = 'How is the position looking?';
const T2 = 'Should we BUY or HOLD this position?';
const T3 = 'How much should we allocate?';

describe('trap 1 — snapshot clobbering', () => {
  it('reasoning about turn 0 AFTER turns 1 and 2 ran still attributes turn 0’s run', async () => {
    const fx = chatDeskFixture();
    const chat = recordedChat({ makeAgent: fx.makeAgent, format: fx.format });
    await chat.send(T1);
    await chat.send(T2);
    await chat.send(T3); // two more runs happened AFTER turn 0

    const report = await chat.reason(0, { embedder: fx.embedder });

    // The report is rooted at turn 0's last LLM call.
    expect(report.step).toBe(chat.turn(0).lastLlmCallId);

    // The frozen per-turn evidence are DISTINCT objects — turn 0's snapshot
    // was captured at turn 0 and is not the clobbered latest.
    expect(chat.turn(0).artifacts.snapshot).not.toBe(chat.turn(2).artifacts.snapshot);

    // Turn 0's evidence still carries turn 0's question ("How is the position
    // looking?") and NOT turn 2's ("allocate") — the exact silent
    // misattribution the last-run-only getLastSnapshot() invites, made
    // structurally impossible.
    const ev0 = JSON.stringify(chat.turn(0).artifacts.events);
    const ev2 = JSON.stringify(chat.turn(2).artifacts.events);
    expect(ev0).toContain('How is the position looking?');
    expect(ev0).not.toContain('allocate');
    expect(ev2).toContain('allocate');
  });
});

describe('trap 2 — byte-exact history threading', () => {
  it('every re-run probe replays turn K’s exact message bytes, not the grown transcript', async () => {
    const reqs: LLMRequest[] = [];
    const fx = chatDeskFixture({ onRequest: (req) => reqs.push(req) });
    const chat = recordedChat({ makeAgent: fx.makeAgent, format: fx.format });
    await chat.send(T1);
    await chat.send(T2);
    await chat.send(T3); // the live transcript has GROWN past turn 1

    const before = reqs.length;
    await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
      checkBaseline: true, // baseline probe is checked too
    });
    const probes = reqs.slice(before);
    expect(probes.length).toBeGreaterThan(0);

    const expected = chat.turn(1).message;
    for (const req of probes) {
      const lastUser = req.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
      // toBe, not toContain — byte-for-byte, including the baseline probe.
      expect(String(lastUser)).toBe(expected);
      expect(String(lastUser)).not.toContain(T3); // no turn-3 line leaked in
    }
  });

  it('baseline fidelity — the baseline probe reproduces turn 1’s exact reply', async () => {
    const reqs: LLMRequest[] = [];
    const fx = chatDeskFixture({ onRequest: (req) => reqs.push(req) });
    const chat = recordedChat({ makeAgent: fx.makeAgent, format: fx.format });
    await chat.send(T1);
    await chat.send(T2);

    const before = reqs.length;
    await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
      checkBaseline: true,
      samples: 2,
    });
    const probes = reqs.slice(before);
    // Baseline probes keep the driver (no ablation) → the marker is present.
    const baseline = probes.filter((r) => (r.systemPrompt ?? '').includes('EXTREMELY bullish'));
    expect(baseline.length).toBe(2);
    for (const req of baseline) {
      expect(scriptedRespond(req)).toBe(chat.turn(1).reply); // all BUY === original
    }
  });
});

describe('trap 3 — runner derivation through the SAME makeAgent', () => {
  it('probes rebuild through the SAME factory with the UNION of persistent + probe specs', async () => {
    const fx = chatDeskFixture();
    const makeAgentSpy = vi.fn(fx.makeAgent);
    // A session carrying a persistent removal (insider-activity), like a fork
    // that carried an exclusion forward.
    const persistent: AblationSpec = {
      kind: 'injection',
      excludeInjectionIds: ['insider-activity'],
    };
    const chat = recordedChat({
      makeAgent: makeAgentSpy,
      format: fx.format,
      removed: [persistent],
    });
    await chat.send(T1);
    await chat.send(T2);
    await chat.reason(1, { embedder: fx.embedder }); // memoize, no makeAgent call

    makeAgentSpy.mockClear();
    await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
      checkBaseline: true,
      samples: 2,
    });

    // All calls now are from the rerun: 2 baseline + 2 ablated = 4.
    const calls = makeAgentSpy.mock.calls.map((c) => c[0].specs);
    expect(calls).toHaveLength(4);

    const hasId = (specs: readonly AblationSpec[], id: string): boolean =>
      specs.some((s) => s.kind === 'injection' && s.excludeInjectionIds.includes(id));

    const ablated = calls.filter((specs) => hasId(specs, 'social-sentiment'));
    const baseline = calls.filter((specs) => !hasId(specs, 'social-sentiment'));
    expect(ablated).toHaveLength(2);
    expect(baseline).toHaveLength(2);

    // Ablated probes got the UNION: persistent (insider) + probe (social).
    for (const specs of ablated) {
      expect(hasId(specs, 'insider-activity')).toBe(true);
      expect(hasId(specs, 'social-sentiment')).toBe(true);
    }
    // Baseline probes got ONLY the persistent specs.
    for (const specs of baseline) {
      expect(hasId(specs, 'insider-activity')).toBe(true);
      expect(hasId(specs, 'social-sentiment')).toBe(false);
    }
  });

  it('a fresh agent + provider is built per probe call (minor trap 4)', async () => {
    const fx = chatDeskFixture();
    const built: unknown[] = [];
    const makeAgentSpy = vi.fn((build: { specs: readonly AblationSpec[]; seed: number }) => {
      const agent = fx.makeAgent(build);
      built.push(agent);
      return agent;
    });
    const chat = recordedChat({ makeAgent: makeAgentSpy, format: fx.format });
    await chat.send(T1);
    await chat.send(T2);
    makeAgentSpy.mockClear();
    built.length = 0;
    await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
      samples: 2,
    });
    // 2 ablated probe agents, each a distinct instance.
    expect(built).toHaveLength(2);
    expect(new Set(built).size).toBe(2);
  });
});

// Sanity: the fixture reproduces the example-7 replies verbatim (the story the
// traps are proved against).
describe('chat-desk fixture — scripted replies are the example-7 story', () => {
  it('T2 BUY, ablated HOLD; T3 ADD on a BUY transcript, KEEP on a HOLD transcript', () => {
    expect(REPLY.buy).toContain('BUY');
    expect(REPLY.hold).toContain('HOLD');
    expect(REPLY.add).toContain('ADD');
    expect(REPLY.keep).toContain('KEEP');
  });
});
