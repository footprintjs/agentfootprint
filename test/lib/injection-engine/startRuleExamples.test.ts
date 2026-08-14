/**
 * Examples on start rules (SG-G) — `examples: [...]` beside a rule's `match` /
 * `when`, and the three properties the check-up can then PROVE by RUNNING the
 * compiled matchers over one declared phrase:
 *
 *   • example-misses-own-rule      (ERROR)   — the rule rejects its own example
 *   • example-shadowed-by-earlier  (ERROR)   — an earlier rule claims it first
 *   • example-unclaimed            (WARNING) — no rule claims it at all
 *
 * Every property is tested twice: it FIRES on the defect, and it does NOT fire
 * on the near-miss beside it. The two field failures that motivated the feature
 * are pinned as regressions (a powerstore-style earlier rule swallowing a longer
 * alternation's phrase; a phrase claimed by nothing), and the zero-delta pins
 * hold the law that a rule without examples behaves byte-identically.
 *
 * Sections follow Convention 3: Unit · Functional · Integration (build + run).
 */

import { describe, it, expect } from 'vitest';
import {
  checkStartRuleExamples,
  validateStartRuleExamples,
  EXAMPLES_BOUNDARY,
  EXAMPLES_ORDER_NOT_CHECKED,
} from '../../../src/lib/injection-engine/skillExamples.js';
import { formatCheckup } from '../../../src/lib/injection-engine/skillGraphCheckup.js';
import type { GraphProblem } from '../../../src/lib/injection-engine/skillGraphCheckup.js';
import {
  skillGraph,
  defineSkill,
  keywordScorer,
  type SkillGraph,
} from '../../../src/injection-engine.js';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

const skill = (id: string) => defineSkill({ id, description: `use ${id}`, body: `${id} body` });

const codes = (graph: SkillGraph): string[] => graph.checkup().problems.map((p) => p.code);
const problemFor = (graph: SkillGraph, code: string): GraphProblem | undefined =>
  graph.checkup().problems.find((p) => p.code === code);

describe('unit: validateStartRuleExamples — teaching refusals', () => {
  const conditional = { hasCondition: true, isIntent: false };

  it('returns undefined when nothing was declared (the zero-cost path)', () => {
    expect(validateStartRuleExamples(undefined, 'entry "a"', conditional)).toBeUndefined();
  });

  it('refuses an EMPTY list, saying why silence would mislead', () => {
    expect(() => validateStartRuleExamples([], 'entry "a"', conditional)).toThrow(
      /empty list declares nothing to prove/,
    );
  });

  it('refuses a non-array, naming the shape that works', () => {
    expect(() => validateStartRuleExamples('refund me', 'entry "a"', conditional)).toThrow(
      /non-empty array of non-empty strings/,
    );
  });

  it('refuses a blank / non-string entry, naming the index', () => {
    expect(() => validateStartRuleExamples(['ok', '  '], 'entry "a"', conditional)).toThrow(
      /`examples\[1\]`/,
    );
    expect(() => validateStartRuleExamples([42], 'entry "a"', conditional)).toThrow(
      /`examples\[0\]` = 42/,
    );
  });

  it('refuses examples on an INTENT rule, naming the tier difference in both directions', () => {
    expect(() =>
      validateStartRuleExamples(['refund me'], 'entry "a"', {
        hasCondition: true,
        isIntent: true,
      }),
    ).toThrow(/SCORING material/);
    expect(() =>
      validateStartRuleExamples(['refund me'], 'entry "a"', {
        hasCondition: true,
        isIntent: true,
      }),
    ).toThrow(/TEST material/);
  });

  it('refuses examples on an UNCONDITIONAL entry — every example would pass by construction', () => {
    expect(() =>
      validateStartRuleExamples(['refund me'], 'entry "a"', {
        hasCondition: false,
        isIntent: false,
      }),
    ).toThrow(/claims EVERY message/);
  });

  it('freezes the copy it returns (the stored list cannot drift from the validated one)', () => {
    const declared = ['refund me'];
    const stored = validateStartRuleExamples(declared, 'entry "a"', conditional);
    expect(stored).toEqual(['refund me']);
    expect(Object.isFrozen(stored)).toBe(true);
    declared.push('later');
    expect(stored).toEqual(['refund me']);
  });
});

describe('unit: checkStartRuleExamples — the walk, over declarations alone', () => {
  it('is silent (and note-free) when no rule declared examples', () => {
    const out = checkStartRuleExamples({
      entries: [{ id: 'a', when: () => true }],
      orderDecides: true,
      hasClassifier: false,
    });
    expect(out.problems).toEqual([]);
    expect(out.notes).toEqual([]);
  });

  it('treats a THROWING predicate as a no-match — the law routing already applies', () => {
    const out = checkStartRuleExamples({
      entries: [
        {
          id: 'a',
          when: () => {
            throw new Error('boom');
          },
          examples: ['hello'],
        },
      ],
      orderDecides: true,
      hasClassifier: false,
    });
    expect(out.problems.map((p) => p.code)).toEqual([
      'example-misses-own-rule',
      'example-unclaimed',
    ]);
    // A throw stays an ERROR: the context it threw on is one every turn 1 hands it.
    expect(out.problems[0]!.kind).toBe('error');
    expect(out.problems[0]!.message).toMatch(/THREW when run on a COLD-START context/);
    expect(out.problems[0]!.message).toMatch(/pure and total/);
  });

  it('runs the predicate on a COLD-START context (iteration 1, the phrase, no cursor)', () => {
    const seen: Array<Record<string, unknown>> = [];
    checkStartRuleExamples({
      entries: [
        {
          id: 'a',
          when: (ctx) => {
            seen.push({ ...ctx });
            return true;
          },
          examples: ['what is my refund'],
        },
      ],
      orderDecides: true,
      hasClassifier: false,
    });
    expect(seen[0]).toEqual({
      iteration: 1,
      userMessage: 'what is my refund',
      history: [],
      activatedInjectionIds: [],
    });
  });

  it('skips the ordering checks when declaration order does not decide, and SAYS so', () => {
    const out = checkStartRuleExamples({
      entries: [{ id: 'a', when: () => false, examples: ['nope'] }],
      orderDecides: false,
      hasClassifier: false,
    });
    // Self-match is order-independent, so it still runs; coverage does not.
    expect(out.problems.map((p) => p.code)).toEqual(['example-misses-own-rule']);
    expect(out.notes).toEqual([EXAMPLES_ORDER_NOT_CHECKED, EXAMPLES_BOUNDARY]);
  });
});

describe('functional: (a) example-misses-own-rule', () => {
  it('FIRES when a rule rejects its own example, quoting the phrase and the matcher', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: /\brefunds\b/i, examples: ['refund my order'] })
      .build({ check: 'off' });
    const problem = problemFor(graph, 'example-misses-own-rule');
    expect(problem?.kind).toBe('error');
    expect(problem?.skill).toBe('billing');
    expect(problem?.example).toBe('refund my order');
    expect(problem?.message).toContain('"refund my order"');
    expect(problem?.message).toContain('/\\brefunds\\b/i');
    expect(problem?.message).toMatch(/Fix the matcher so it covers the phrase/);
  });

  it('does NOT fire on the near-miss: the same matcher one character wider', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: /\brefunds?\b/i, examples: ['refund my order'] })
      .build();
    expect(codes(graph)).toEqual([]);
  });

  it('reads a `when` predicate too — the check that regex analysis cannot do', () => {
    const graph = skillGraph()
      .entry(skill('billing'), {
        when: (ctx) => ctx.userMessage.includes('invoice'),
        examples: ['refund my order'],
      })
      .build({ check: 'off' });
    expect(problemFor(graph, 'example-misses-own-rule')?.message).toContain('`when` predicate');
  });

  it('is an ERROR for a DATA matcher — the default `check: throw` build refuses it', () => {
    expect(() =>
      skillGraph()
        .entry(skill('billing'), { match: /\brefunds\b/i, examples: ['refund my order'] })
        .build(),
    ).toThrow(/example-misses-own-rule/);
    // …and says WHY that no-match holds under every context, not just this one.
    const problem = problemFor(
      skillGraph()
        .entry(skill('billing'), { match: /\brefunds\b/i, examples: ['refund my order'] })
        .build({ check: 'off' }),
      'example-misses-own-rule',
    );
    expect(problem?.kind).toBe('error');
    expect(problem?.message).toMatch(/reads the user message and nothing else/);
  });

  // REGRESSION (finding 3). The check runs every predicate on ONE context —
  // iteration 1 with an EMPTY history — but turn 2+ of a conversation starts
  // cold in cursor terms while CARRYING history (`a second run() begins cold`;
  // history rides `followUp`). A `when` gated on conversation state is a
  // legitimate declaration that this context cannot satisfy, so erroring on it
  // refused a graph whose router really does claim the phrase. Two halves:
  // the severity is a warning, and the message names the context it judged.
  describe('a `when` gated on conversation state is a WARNING, and the message says why', () => {
    const laterTurnRule = (): SkillGraph =>
      skillGraph()
        .entry(skill('followup-refund'), {
          when: (ctx) => ctx.history.length > 0 && /refund/i.test(ctx.userMessage),
          examples: ['refund my order'],
        })
        .entry(skill('smalltalk'), { match: /\bhello\b/i })
        .build({ check: 'off' });

    it('does not fail the build — the declaration is legitimate', () => {
      expect(() =>
        skillGraph()
          .entry(skill('followup-refund'), {
            when: (ctx) => ctx.history.length > 0 && /refund/i.test(ctx.userMessage),
            examples: ['refund my order'],
          })
          .entry(skill('smalltalk'), { match: /\bhello\b/i })
          .build(),
      ).not.toThrow();
      expect(problemFor(laterTurnRule(), 'example-misses-own-rule')?.kind).toBe('warning');
    });

    it('names the exact context it judged under, and why that makes it a warning', () => {
      const message = problemFor(laterTurnRule(), 'example-misses-own-rule')?.message ?? '';
      expect(message).toContain('iteration 1');
      expect(message).toContain('empty `history`');
      expect(message).toMatch(/gated on conversation state/);
      expect(message).toMatch(/warning and not the error a data matcher gets/);
    });

    it('and the router really does claim it on a later turn — the check was the wrong one', () => {
      expect(
        laterTurnRule().explainNextSkill({
          iteration: 1,
          userMessage: 'refund my order',
          history: [
            { role: 'user', content: 'hello there' },
            { role: 'assistant', content: 'hi' },
          ],
          activatedInjectionIds: [],
        }),
      ).toEqual({ to: 'followup-refund', by: 'entry' });
    });

    it('the coverage warning beside it names the cold context too', () => {
      expect(problemFor(laterTurnRule(), 'example-unclaimed')?.message).toContain(
        'COLD-START context',
      );
    });
  });
});

describe('functional: (b) example-shadowed-by-earlier', () => {
  const shadowed = (): SkillGraph =>
    skillGraph()
      .entry(skill('powerstore-health'), {
        match: /\bpowerstore\b/i,
        examples: ['is powerstore healthy'],
      })
      .entry(skill('array-inventory'), {
        match: /\b(array|powerstore|volume)\b/i,
        examples: ['list every array and powerstore volume'],
      })
      .build({ check: 'off' });

  it('FIRES naming N, M and the phrase', () => {
    const problem = problemFor(shadowed(), 'example-shadowed-by-earlier');
    expect(problem?.kind).toBe('error');
    expect(problem?.skill).toBe('array-inventory');
    expect(problem?.from).toBe('powerstore-health');
    expect(problem?.to).toBe('array-inventory');
    expect(problem?.example).toBe('list every array and powerstore volume');
    expect(problem?.message).toMatch(/first matching rule in declaration order wins/);
    expect(problem?.message).toMatch(/no regex intersection was decided/);
  });

  it('does NOT fire when the earlier rule does not claim the phrase (the near-miss)', () => {
    const graph = skillGraph()
      .entry(skill('powerstore-health'), {
        match: /\bpowerstore\b/i,
        examples: ['is powerstore healthy'],
      })
      .entry(skill('array-inventory'), {
        match: /\b(array|volume)\b/i,
        examples: ['list every array'],
      })
      .build();
    expect(codes(graph)).toEqual([]);
  });

  it("does NOT fire when the claimant is LATER — that is the rule's own miss, reported once", () => {
    const graph = skillGraph()
      .entry(skill('array-inventory'), { match: /\barray\b/i, examples: ['is powerstore healthy'] })
      .entry(skill('powerstore-health'), { match: /\bpowerstore\b/i })
      .build({ check: 'off' });
    expect(codes(graph)).toEqual(['example-misses-own-rule']);
  });

  it('an earlier UNCONDITIONAL entry is NOT this code — the two start laws disagree there', () => {
    const graph = skillGraph()
      .entry(skill('concierge'))
      .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
      .build({ check: 'off' });
    expect(problemFor(graph, 'example-shadowed-by-earlier')).toBeUndefined();
    expect(problemFor(graph, 'example-shadowed-by-default')?.from).toBe('concierge');
  });

  it('names BOTH claimants when the two laws agree the turn is not this rule’s', () => {
    // A default FIRST (the cold walk stops there) and a conditional rule that
    // also claims the phrase before the owner (tier 1 stops there). Different
    // claimants, same outcome — provable, so still an ERROR, but the message
    // may not pretend one law is the law.
    const graph = skillGraph()
      .entry(skill('concierge'))
      .entry(skill('triage'), { match: /\brefund\b/i })
      .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
      .build({ check: 'off' });
    const problem = problemFor(graph, 'example-shadowed-by-earlier');
    expect(problem?.kind).toBe('error');
    expect(problem?.message).toContain('under BOTH start laws');
    expect(problem?.message).toContain('"concierge"');
    expect(problem?.message).toContain('"triage"');
  });
});

// REGRESSION (findings 1 + 2). An UNCONDITIONAL earlier entry used to raise the
// shadowing ERROR, and the message fabricated a `when` predicate that entry does
// not have plus a matcher the author has no way to narrow. Worse, the verdict
// disagreed with the router: an unconditional entry is a DEFAULT, and the
// turn-start cascade's tier 1 (`firstRuleMatch`) reads conditional rules only —
// and that cascade is mounted by `continuity: 'conversation'` as well as by
// `.classify()`, a decision taken at AGENT MOUNT that the graph cannot see.
describe('functional: (b′) example-shadowed-by-default — the mount decides, so the report says both', () => {
  const withDefaultFirst = (): SkillGraph =>
    skillGraph()
      .entry(skill('concierge'))
      .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
      .build({ check: 'off' });

  it('is a WARNING, so the default `check: throw` build does not refuse the graph', () => {
    expect(() =>
      skillGraph()
        .entry(skill('concierge'))
        .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
        .build(),
    ).not.toThrow();
    const problem = problemFor(withDefaultFirst(), 'example-shadowed-by-default');
    expect(problem?.kind).toBe('warning');
    expect(problem?.skill).toBe('billing');
    expect(problem?.from).toBe('concierge');
    expect(problem?.to).toBe('billing');
    expect(problem?.example).toBe('refund my order');
  });

  it('never invents a condition the entry does not declare, nor a fix it cannot apply', () => {
    const message = problemFor(withDefaultFirst(), 'example-shadowed-by-default')?.message ?? '';
    expect(message).toContain('declares no `match` and no `when`');
    expect(message).not.toContain('its `when` predicate');
    expect(message).not.toMatch(/narrow "concierge"/);
    // The proof clause counts the matchers that really ran: one.
    expect(message).not.toContain('BOTH compiled matchers');
    expect(message).toContain('declares none, so the cold walk stops there by construction');
  });

  it('names BOTH readings — the default mount and the turn-start cascade', () => {
    const message = problemFor(withDefaultFirst(), 'example-shadowed-by-default')?.message ?? '';
    expect(message).toContain("continuity: 'turn'");
    expect(message).toContain("continuity: 'conversation'");
    expect(message).toContain('the turn starts on "billing"');
  });

  it('says so even when the cascade reading claims nothing at all', () => {
    const graph = skillGraph()
      .entry(skill('concierge'))
      .entry(skill('billing'), { match: /\brefunds\b/i, examples: ['refund my order'] })
      .build({ check: 'off' });
    expect(problemFor(graph, 'example-shadowed-by-default')?.message).toContain(
      'no entry at all, falling onward to the next tier',
    );
  });

  it('a CLASSIFIER graph keeps the tier-1 law alone — an unconditional entry never claims', () => {
    const graph = skillGraph()
      .entry(skill('concierge'))
      .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
      .entry(skill('shipping'), {
        match: { intent: 'customer asks where a delivery is', examples: ['track my parcel'] },
      })
      .classify(keywordScorer())
      .build({ check: 'off' });
    expect(codes(graph).filter((c) => c.startsWith('example-'))).toEqual([]);
  });
});

describe('functional: (c) example-unclaimed', () => {
  it('FIRES when nothing claims the phrase, and names the fall-through', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: { keywords: ['refund'] }, examples: ['where is my money'] })
      .build({ check: 'off' });
    const problem = problemFor(graph, 'example-unclaimed');
    expect(problem?.kind).toBe('warning');
    expect(problem?.example).toBe('where is my money');
    expect(problem?.message).toContain('falls through to the model tier');
    expect(problem?.message).toMatch(/a phrasing nobody wrote is not checked/);
  });

  it('does NOT fire when ANOTHER rule claims it (routing is still deterministic)', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: { keywords: ['money'] }, examples: ['where is my money'] })
      .entry(skill('shipping'), { match: { keywords: ['parcel'] }, examples: ['track my parcel'] })
      .build();
    expect(codes(graph)).toEqual([]);
  });

  it('names the CLASSIFIER as the next tier when one is configured', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: { keywords: ['refund'] }, examples: ['where is my money'] })
      .entry(skill('shipping'), {
        match: { intent: 'customer asks where a delivery is', examples: ['track my parcel'] },
      })
      .classify(keywordScorer())
      .build({ check: 'off' });
    expect(problemFor(graph, 'example-unclaimed')?.message).toContain(
      'falls past tier 1 to the classifier',
    );
  });
});

describe('functional: the field cases, reproduced as regressions', () => {
  // FIELD CASE A — an earlier rule named for one product swallowed an inventory
  // rule's phrase because an array is NAMED like that product's boxes. Two
  // DIFFERENT regex sources, so `compareMatchers` is honestly silent: only a
  // witness phrase can decide it.
  it("A: a powerstore-style earlier rule swallows a longer alternation's phrase", () => {
    const graph = skillGraph()
      .entry(skill('powerstore-health'), {
        match: /\bpowerstore\b|\bshpstr[a-z]*\d+\b/i,
        examples: ['is powerstore healthy'],
      })
      .entry(skill('array-inventory'), {
        match: /\b(array|volume|pool|shpstrprncl\d+)\b/i,
        examples: ["what's running on shpstrprncl101"],
      })
      .build({ check: 'off' });
    expect(codes(graph)).toEqual(['example-shadowed-by-earlier']);
    // The matcher-vs-matcher check stays silent, exactly as designed — the new
    // code reports what regex analysis refuses to decide, it does not replace it.
    expect(codes(graph)).not.toContain('rules-shadowed-by-order');
    const problem = problemFor(graph, 'example-shadowed-by-earlier');
    expect(problem?.example).toBe("what's running on shpstrprncl101");
    expect(problem?.from).toBe('powerstore-health');
  });

  // FIELD CASE B — the stronger one: the phrase matched NOTHING, fell to the
  // model tier, and the model picked the wrong skill because an array name
  // looks like a hostname. Absence: no matcher comparison could ever catch it.
  it('B: a phrase claimed by nothing is reported as absence, not as overlap', () => {
    const graph = skillGraph()
      .entry(skill('host-health'), { match: /\bhost\b/i, examples: ['is the host up'] })
      .entry(skill('array-inventory'), {
        match: /\b(array|volume|pool)\b/i,
        examples: ["what's running on shpstrprncl101"],
      })
      .build({ check: 'off' });
    expect(codes(graph)).toEqual(['example-misses-own-rule', 'example-unclaimed']);
    expect(problemFor(graph, 'example-unclaimed')?.message).toContain('model tier');
  });
});

describe('functional: the boundary is on the report, not only in prose', () => {
  it('graph.checkup().notes carries the sentence whenever examples were declared', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
      .build();
    expect(graph.checkup().notes).toEqual([EXAMPLES_BOUNDARY]);
    expect(EXAMPLES_BOUNDARY).toContain('no warning here is not proof of coverage');
  });

  it('formatCheckup renders notes after the problems, tagged [note]', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
      .build();
    expect(formatCheckup(graph.checkup())).toBe(`  [note] ${EXAMPLES_BOUNDARY}`);
  });

  it('a clean graph with NO examples has no notes key at all', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: /\brefund\b/i })
      .build();
    expect('notes' in graph.checkup()).toBe(false);
  });
});

describe('functional: tier 2 keeps its own examples — they are SCORING material', () => {
  it('intent examples are NOT re-purposed as tier-1 tests (no example-* problem)', () => {
    const graph = skillGraph()
      .entry(skill('billing'), {
        match: { intent: 'customer wants a refund', examples: ['charged twice'] },
      })
      .entry(skill('shipping'), {
        match: { intent: 'customer asks where a delivery is', examples: ['track my parcel'] },
      })
      .classify(keywordScorer())
      .build();
    expect(codes(graph).filter((c) => c.startsWith('example-'))).toEqual([]);
    expect('notes' in graph.checkup()).toBe(false);
  });

  it('the classifier still receives them as candidates at run time', () => {
    const graph = skillGraph()
      .entry(skill('billing'), {
        match: { intent: 'customer wants a refund', examples: ['charged twice'] },
      })
      .classify(keywordScorer())
      .build();
    expect(graph.turnRouting?.intentCandidates()).toEqual([
      { id: 'billing', intent: 'customer wants a refund', examples: ['charged twice'] },
    ]);
  });

  it('a rule may not carry BOTH lists — the refusal names the two jobs', () => {
    expect(() =>
      skillGraph()
        .entry(skill('billing'), {
          match: { intent: 'customer wants a refund', examples: ['charged twice'] },
          examples: ['refund my order'],
        })
        .classify(keywordScorer())
        .build(),
    ).toThrow(/two example lists with two different jobs/);
  });
});

// REGRESSION (finding 2) at the level the disagreement is REAL: the router. The
// check-up used to assert, as a build-failing ERROR, that the turn "starts on
// concierge, never on billing" — while an agent mounted with
// `continuity: 'conversation'` routes that very turn to billing.
describe('integration: the check-up agrees with the router it describes', () => {
  const graph = (): SkillGraph =>
    skillGraph()
      .entry(skill('concierge'))
      .entry(skill('billing'), { match: /\brefund\b/i, examples: ['refund my order'] })
      .build({ check: 'off' });

  it("routes the turn to billing under continuity: 'conversation', and no ERROR denies it", async () => {
    const g = graph();
    const agent = Agent.create({ provider: mock({ responses: ['Refunded.'] }), model: 'mock' })
      .skillGraph(g, { continuity: 'conversation' })
      .build();
    const routed: Array<{ by: string; to?: string }> = [];
    agent.on('agentfootprint.skill.turn_routed', (e: { payload: { by: string; to?: string } }) =>
      routed.push({ by: e.payload.by, ...(e.payload.to !== undefined && { to: e.payload.to }) }),
    );
    await agent.run('refund my order');
    expect(routed).toEqual([{ by: 'entry', to: 'billing' }]);
    // The report may WARN about the two readings; it may not ERROR against one.
    expect(g.checkup().problems.filter((p) => p.kind === 'error')).toEqual([]);
  });

  it('and the default mount really does start on the unconditional entry', () => {
    expect(
      graph().explainNextSkill({
        iteration: 1,
        userMessage: 'refund my order',
        history: [],
        activatedInjectionIds: [],
      }),
    ).toEqual({ to: 'concierge', by: 'entry' });
  });
});

describe('integration: the object (config) form', () => {
  it('carries examples through start.rules and reports the same problems', () => {
    const billing = skill('billing');
    const shipping = skill('shipping');
    expect(() =>
      skillGraph({
        skills: [billing, shipping],
        start: {
          rules: [
            { use: 'billing', match: { keywords: ['refund'] }, examples: ['track my parcel'] },
            { use: 'shipping', match: { keywords: ['parcel'] } },
          ],
        },
      }),
    ).toThrow(/example-misses-own-rule/);
  });

  it('refuses an unusable list in the config form too, naming the rule', () => {
    const billing = skill('billing');
    expect(() =>
      skillGraph({
        skills: [billing],
        start: { rules: [{ use: 'billing', match: { keywords: ['refund'] }, examples: [] }] },
      }),
    ).toThrow(/entry "billing" declares an `examples` list/);
  });
});

describe('integration: zero delta when unused', () => {
  const billing = skill('billing');
  const shipping = skill('shipping');
  const withoutExamples = (): SkillGraph =>
    skillGraph()
      .entry(billing, { match: { keywords: ['refund'] } })
      .entry(shipping, { match: { keywords: ['parcel'] } })
      .route(billing, shipping, { onToolReturn: 'lookup_order' })
      .build();
  const withExamples = (): SkillGraph =>
    skillGraph()
      .entry(billing, { match: { keywords: ['refund'] }, examples: ['refund my order'] })
      .entry(shipping, { match: { keywords: ['parcel'] }, examples: ['track my parcel'] })
      .route(billing, shipping, { onToolReturn: 'lookup_order' })
      .build();

  it('a graph with no examples reports the byte-identical check-up object', () => {
    const before = withoutExamples().checkup();
    expect(before).toEqual({ ok: true, problems: [] });
    expect(Object.keys(before)).toEqual(['ok', 'problems']);
  });

  it('declaring examples changes NO compiled skill — not the trigger, not the metadata', () => {
    const plain = withoutExamples();
    const noted = withExamples();
    expect(JSON.stringify(noted.skills)).toBe(JSON.stringify(plain.skills));
    expect(noted.toMermaid()).toBe(plain.toMermaid());
    expect(JSON.stringify(noted.edges)).toBe(JSON.stringify(plain.edges));
  });

  it('routing answers identically with and without them', () => {
    const ctx = {
      iteration: 1,
      userMessage: 'refund my order',
      history: [],
      activatedInjectionIds: [],
    };
    expect(withExamples().nextSkill(ctx)).toBe(withoutExamples().nextSkill(ctx));
    expect(withExamples().explainNextSkill(ctx)).toEqual(withoutExamples().explainNextSkill(ctx));
  });

  it('and emits no new events on a real run', async () => {
    const typesFor = async (graph: SkillGraph): Promise<string[]> => {
      const agent = Agent.create({
        provider: mock({ responses: ['Refunded.'] }),
        model: 'mock',
      })
        .skillGraph(graph)
        .build();
      const seen: string[] = [];
      agent.on('*', (e: { type: string }) => seen.push(e.type));
      await agent.run('refund my order');
      return seen;
    };
    expect(await typesFor(withExamples())).toEqual(await typesFor(withoutExamples()));
  });
});
