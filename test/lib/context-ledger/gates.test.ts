/**
 * context-ledger gates (L2) — demote, never starve.
 *
 * What is being pinned:
 * 1. THE policy principle: below minOffers everything passes (no premature
 *    judgment); above it, earners pass and non-earners are demoted — but
 *    parole (refreshEvery) lets a demoted piece through periodically so it
 *    keeps generating fresh ledger data. A verdict can never become
 *    self-fulfilling.
 * 2. Each gate conforms to its EXISTING seam: ToolGatePredicate boolean,
 *    EntryScorer ranking pressure (never exclusion), injection trigger
 *    rewrite (always → rule, rule → AND, demand-driven untouched).
 */

import { describe, expect, it } from 'vitest';
import { defineInstruction, defineSkill } from '../../../src/injection-engine.js';

import {
  contextLedger,
  ledgerEntryScorer,
  ledgerGated,
  ledgerToolGate,
} from '../../../src/lib/context-ledger/index.js';
import type { ContextLedger, LedgerJSON } from '../../../src/lib/context-ledger/index.js';
import type { EntryScorer } from '../../../src/lib/injection-engine/entryScorer.js';
import type { InjectionContext } from '../../../src/lib/injection-engine/types.js';

/** A ledger seeded via importJSON — rows are data, no run needed. */
function seededLedger(
  rows: Array<{ id: string; kind: 'tool' | 'skill' | 'injection'; offered: number; used: number }>,
): ContextLedger {
  const ledger = contextLedger();
  const json: LedgerJSON = {
    version: 1,
    runsRecorded: 1,
    rows: rows.map((r) => ({
      ...r,
      approxTokensSpent: r.offered * 100,
      usedVia: {},
      runsSeen: 1,
      outcomes: {},
      earnRate: r.offered > 0 ? r.used / r.offered : 0,
    })),
  };
  ledger.importJSON(json);
  return ledger;
}

const CTX = { iteration: 1 } as unknown as InjectionContext;

describe('ledgerToolGate', () => {
  it('passes unknown and under-observed tools; demotes proven non-earners', () => {
    const ledger = seededLedger([
      { id: 'earner', kind: 'tool', offered: 20, used: 5 },
      { id: 'deadweight', kind: 'tool', offered: 20, used: 0 },
      { id: 'newcomer', kind: 'tool', offered: 2, used: 0 },
    ]);
    const gate = ledgerToolGate(ledger);
    expect(gate('earner', {} as never)).toBe(true);
    expect(gate('newcomer', {} as never)).toBe(true); // below minOffers — no judgment
    expect(gate('never-seen', {} as never)).toBe(true); // unknown — always include
    expect(gate('deadweight', {} as never)).toBe(false); // demoted
  });

  it('parole: every refreshEvery-th decision lets a demoted tool through', () => {
    const ledger = seededLedger([{ id: 'deadweight', kind: 'tool', offered: 20, used: 0 }]);
    const gate = ledgerToolGate(ledger, { refreshEvery: 3 });
    const decisions = Array.from({ length: 6 }, () => gate('deadweight', {} as never));
    expect(decisions).toEqual([false, false, true, false, false, true]); // never starved
  });
});

describe('ledgerEntryScorer', () => {
  const inner: EntryScorer = {
    name: 'flat',
    score: (input) => ({
      scorer: 'flat',
      chosen: input.candidates[0]?.id,
      ranked: input.candidates.map((c) => ({
        id: c.id,
        score: 1,
        relevance: 1 / input.candidates.length,
      })),
    }),
  };

  it('demotes non-earning skills by ranking pressure — never exclusion', async () => {
    const ledger = seededLedger([
      { id: 'good-skill', kind: 'skill', offered: 20, used: 10 },
      { id: 'dead-skill', kind: 'skill', offered: 20, used: 0 },
    ]);
    const scorer = ledgerEntryScorer(ledger, inner);
    const out = await scorer.score({
      userMessage: 'help',
      candidates: [
        { id: 'dead-skill', description: 'a' },
        { id: 'good-skill', description: 'b' },
      ],
    });
    expect(out.scorer).toBe('ledger(flat)');
    expect(out.chosen).toBe('good-skill'); // demotion flipped the flat tie
    const dead = out.ranked.find((r) => r.id === 'dead-skill')!;
    expect(dead.score).toBeLessThan(1); // demoted, still IN the ranking
    expect(out.ranked).toHaveLength(2);
  });

  it('REVIEW PIN: chosen and relevance move together when demotion flips the winner', async () => {
    // The exact counterexample from review finding #2: base scores [2,1] →
    // leader demoted → the pick flips to the runner-up, and the surfaced
    // relevance must flip WITH it (argmax-score == argmax-relevance).
    const skewed: EntryScorer = {
      name: 'skewed',
      score: (input) => ({
        scorer: 'skewed',
        chosen: 'dead-skill',
        ranked: input.candidates.map((c) => ({
          id: c.id,
          score: c.id === 'dead-skill' ? 2 : 1,
          relevance: c.id === 'dead-skill' ? 0.73 : 0.27,
        })),
      }),
    };
    const ledger = seededLedger([{ id: 'dead-skill', kind: 'skill', offered: 20, used: 0 }]);
    const scorer = ledgerEntryScorer(ledger, skewed);
    const out = await scorer.score({
      userMessage: 'x',
      candidates: [
        { id: 'dead-skill', description: 'a' },
        { id: 'live-skill', description: 'b' },
      ],
    });
    expect(out.chosen).toBe('live-skill'); // demotion flipped the pick...
    const byId = new Map(out.ranked.map((r) => [r.id, r]));
    expect(byId.get('live-skill')!.relevance).toBeGreaterThan(byId.get('dead-skill')!.relevance); // ...and relevance followed
  });

  it('a demoted skill still wins when it is the only candidate', async () => {
    const ledger = seededLedger([{ id: 'dead-skill', kind: 'skill', offered: 20, used: 0 }]);
    const scorer = ledgerEntryScorer(ledger, inner);
    const out = await scorer.score({
      userMessage: 'x',
      candidates: [{ id: 'dead-skill', description: 'a' }],
    });
    expect(out.chosen).toBe('dead-skill'); // pressure, not exclusion
  });
});

describe('ledgerGated (injections)', () => {
  it("an 'always' injection becomes a ledger-backed rule", () => {
    const ledger = seededLedger([{ id: 'useless', kind: 'injection', offered: 20, used: 0 }]);
    const gated = ledgerGated(defineInstruction({ id: 'useless', prompt: 'x' }), ledger);
    expect(gated.trigger.kind).toBe('rule');
    const activeWhen = (gated.trigger as { activeWhen: (c: InjectionContext) => boolean })
      .activeWhen;
    expect(activeWhen(CTX)).toBe(false); // demoted
  });

  it("a 'rule' injection ANDs its original condition with the verdict", () => {
    const earnerLedger = seededLedger([{ id: 'ruled', kind: 'injection', offered: 20, used: 10 }]);
    const original = defineInstruction({
      id: 'ruled',
      prompt: 'x',
      activeWhen: (ctx) => ctx.iteration > 5,
    });
    const gated = ledgerGated(original, earnerLedger);
    const activeWhen = (gated.trigger as { activeWhen: (c: InjectionContext) => boolean })
      .activeWhen;
    expect(activeWhen({ iteration: 1 } as never)).toBe(false); // original rule still gates
    expect(activeWhen({ iteration: 9 } as never)).toBe(true); // rule true AND earning
  });

  it('demand-driven triggers pass through untouched', () => {
    const ledger = seededLedger([]);
    const skill = defineSkill({ id: 's', description: 'd', body: 'i' });
    expect(ledgerGated(skill, ledger)).toBe(skill); // llm-activated — unchanged reference
  });

  it('unknown/under-observed injections stay active (no premature judgment)', () => {
    const ledger = seededLedger([{ id: 'fresh', kind: 'injection', offered: 1, used: 0 }]);
    const gated = ledgerGated(defineInstruction({ id: 'fresh', prompt: 'x' }), ledger);
    const activeWhen = (gated.trigger as { activeWhen: (c: InjectionContext) => boolean })
      .activeWhen;
    expect(activeWhen(CTX)).toBe(true);
  });
});
