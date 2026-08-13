/**
 * Unit tests — the artifact vocabularies and the SG-F checkup rule (9.25.0).
 *
 * Pattern: Test-as-specification. The two programs join here: an artifact
 * `kind` is the consumer vocabulary a claim ticket carries, and a skill may
 * now declare which kinds it `produces` and `consumes`. This file locks the
 * SATISFIABILITY TRUTH TABLE (the whole rule, arm by arm), the checkup's
 * HONESTY (it warns, it never errors, it says what it cannot see, and it does
 * NOT fire on the runtime-flow case), the authoring refusals, and the
 * zero-cost promise.
 *
 * The honesty half is the point. A build-time check over declarations cannot
 * see a store seeded by an earlier run, another agent, or a tool that mints
 * without declaring — so the one case it must never get wrong is a legitimate
 * runtime flow, which is CONSTRUCTED here rather than argued about.
 *
 * 7 test types per Convention 3: unit (each arm alone), functional
 * (byte-identical-when-unused), integration (through a real skillGraph
 * checkup), property (a producer anywhere silences it, for every position),
 * security (kinds are compared as exact literals, never as patterns),
 * performance/load (a 200-skill agent).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { Agent, defineTool, inMemoryArtifacts } from '../../../src/index.js';
import { defineSkill, skillGraph, type Injection } from '../../../src/doors/context.js';
import { mock } from '../../../src/doors/providers.js';
import {
  checkArtifactVocabularies,
  vocabularyOf,
} from '../../../src/lib/injection-engine/skillVocabulary.js';

afterEach(() => {
  disableDevMode();
  vi.restoreAllMocks();
});

// ── helpers ──────────────────────────────────────────────────────────────────

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

/** A tool with a REAL redemption path: it declares `wants`, so the framework
 *  resolves the ref at dispatch against the live store. */
const wantsTool = (name: string, kind: string) =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { dataset: { type: 'string' } } },
    wants: { dataset: kind },
    execute: () => `${name} result`,
  });

type SkillOpts = Parameters<typeof defineSkill>[0];

const skill = (id: string, over: Partial<SkillOpts> = {}): Injection =>
  defineSkill({
    id,
    description: `use ${id}`,
    body: `${id} body`,
    ...over,
  } as SkillOpts);

const codes = (skills: readonly Injection[]) =>
  checkArtifactVocabularies(skills).map((p) => p.code);

const messages = (skills: readonly Injection[]) =>
  checkArtifactVocabularies(skills).map((p) => p.message);

const UNSATISFIED = 'artifact-kind-unsatisfied';

// ═══ 1. The satisfiability truth table — a SKILL's `consumes` ════════════════

describe('a skill consuming a kind: the truth table', () => {
  it('unit: NOTHING produces it → one warning', () => {
    expect(codes([skill('charting', { consumes: ['dataset/rows'] })])).toEqual([UNSATISFIED]);
  });

  it('unit: ANOTHER skill produces it → satisfied', () => {
    expect(
      codes([
        skill('charting', { consumes: ['dataset/rows'] }),
        skill('fetching', { produces: ['dataset/rows'] }),
      ]),
    ).toEqual([]);
  });

  it("unit: another skill's STEP produces it → satisfied", () => {
    expect(
      codes([
        skill('charting', { consumes: ['dataset/rows'] }),
        skill('fetching', {
          tools: [tool('pull')] as never,
          steps: [{ tool: 'pull', note: 'pull the rows', produces: ['dataset/rows'] }],
        }),
      ]),
    ).toEqual([]);
  });

  it('unit: the consuming skill produces it ITSELF → satisfied (a self-loop is a real shape)', () => {
    expect(
      codes([skill('refining', { consumes: ['dataset/rows'], produces: ['dataset/rows'] })]),
    ).toEqual([]);
  });

  it('unit: one of its own tools `wants` it → satisfied (THE runtime-flow arm)', () => {
    // Nothing on this agent produces the kind, and that is CORRECT: the ref
    // arrives from outside and is redeemed at dispatch against a store that
    // outlives the turn. A warning here would be a false alarm on the one
    // flow the framework explicitly supports.
    expect(
      codes([
        skill('charting', {
          consumes: ['dataset/rows'],
          tools: [wantsTool('render', 'dataset/rows')] as never,
        }),
      ]),
    ).toEqual([]);
  });

  it('unit: a wants-tool for a DIFFERENT kind does not silence it', () => {
    expect(
      codes([
        skill('charting', {
          consumes: ['dataset/rows'],
          tools: [wantsTool('render', 'chart/spec')] as never,
        }),
      ]),
    ).toEqual([UNSATISFIED]);
  });

  it('unit: each unsatisfied kind gets its OWN warning — two gaps are two facts', () => {
    expect(codes([skill('charting', { consumes: ['dataset/rows', 'chart/spec'] })])).toEqual([
      UNSATISFIED,
      UNSATISFIED,
    ]);
  });
});

// ═══ 2. The truth table — a STEP's `consumes` ═══════════════════════════════

describe('a step consuming a kind: the two extra arms', () => {
  const stepSkill = (over: Partial<SkillOpts> = {}) =>
    skill('reporting', {
      tools: [tool('fetch'), tool('render')] as never,
      steps: [
        { tool: 'fetch', note: 'get the rows' },
        { tool: 'render', note: 'draw it', consumes: ['dataset/rows'] },
      ],
      ...over,
    });

  it('unit: nothing precedes it → one warning naming the step and its tool', () => {
    const problems = checkArtifactVocabularies([stepSkill()]);
    expect(problems.map((p) => p.code)).toEqual([UNSATISFIED]);
    expect(problems[0]!.message).toContain(`Step 2 of "reporting" ('render')`);
  });

  it('unit: an EARLIER step produces it → satisfied', () => {
    expect(
      codes([
        skill('reporting', {
          tools: [tool('fetch'), tool('render')] as never,
          steps: [
            { tool: 'fetch', note: 'get the rows', produces: ['dataset/rows'] },
            { tool: 'render', note: 'draw it', consumes: ['dataset/rows'] },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("unit: the skill's OWN `consumes` names it → the STEP is satisfied, and the gap moves UP a level", () => {
    // The step is answered — the skill's contract says the kind arrived from
    // outside, so the step may rely on it. But that skill-level claim is now
    // the thing nothing satisfies, so exactly one warning survives and it is
    // the SKILL's. The gap does not disappear by being re-declared one level
    // up; it moves to where it can actually be answered.
    const problems = checkArtifactVocabularies([stepSkill({ consumes: ['dataset/rows'] })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('Skill "reporting" declares consumes');
    expect(problems[0]!.message).not.toContain('Step 2');
  });

  it("unit: the skill's own `consumes` PLUS a wants-tool → the whole flow is silent", () => {
    // The honest end state of the case above: the skill says the kind arrives
    // from outside, and a tool carries the redemption path that makes it true.
    expect(
      codes([
        skill('reporting', {
          consumes: ['dataset/rows'],
          tools: [tool('fetch'), wantsTool('render', 'dataset/rows')] as never,
          steps: [
            { tool: 'fetch', note: 'get the rows' },
            { tool: 'render', note: 'draw it', consumes: ['dataset/rows'] },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("unit: the step's own tool `wants` it → satisfied", () => {
    expect(
      codes([
        skill('reporting', {
          tools: [tool('fetch'), wantsTool('render', 'dataset/rows')] as never,
          steps: [
            { tool: 'fetch', note: 'get the rows' },
            { tool: 'render', note: 'draw it', consumes: ['dataset/rows'] },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("unit: ANOTHER skill's tool wanting it does NOT satisfy this step — wants is scoped to the carrier", () => {
    expect(
      codes([
        stepSkill(),
        skill('elsewhere', { tools: [wantsTool('other', 'dataset/rows')] as never }),
      ]),
    ).toEqual([UNSATISFIED]);
  });
});

// ═══ 3. Honesty — what the warning says, and what it never becomes ══════════

describe('the warning is honest about its own reach', () => {
  const problem = () =>
    checkArtifactVocabularies([skill('charting', { consumes: ['dataset/rows'] })])[0]!;

  it('unit: it is a WARNING, never an error — it cannot see enough to be one', () => {
    expect(problem().kind).toBe('warning');
  });

  it('unit: it states the three things it cannot see', () => {
    const message = problem().message;
    expect(message).toContain('DECLARATIONS only');
    expect(message).toMatch(/outlive/i); // artifacts outlive the turn that made them
    expect(message).toMatch(/does not follow route order/i);
  });

  it('unit: it names the redemption path that would make it correct', () => {
    expect(problem().message).toContain('wants');
  });

  it('unit: it names what the agent CAN produce, not only what it cannot', () => {
    const message = messages([
      skill('charting', { consumes: ['dataset/rows'] }),
      skill('other', { produces: ['chart/spec'] }),
    ])[0]!;
    expect(message).toContain("What this agent declares it produces: 'chart/spec'");
  });

  it('unit: with no producers at all it says THAT, rather than printing an empty list', () => {
    expect(problem().message).toContain('Nothing on this agent declares `produces` at all');
  });

  it('unit: it carries the skill id, so a reader can find it', () => {
    expect(problem().skill).toBe('charting');
  });
});

// ═══ 4. Zero cost when unused ═══════════════════════════════════════════════

describe('functional: a skill without vocabularies is byte-identical', () => {
  it('no declaration anywhere → no problems, and the check short-circuits', () => {
    expect(checkArtifactVocabularies([skill('a'), skill('b')])).toEqual([]);
  });

  it('the metadata bag grows NO keys when nothing is declared', () => {
    const plain = skill('plain') as unknown as { metadata: Record<string, unknown> };
    expect('produces' in plain.metadata).toBe(false);
    expect('consumes' in plain.metadata).toBe(false);
  });

  it('vocabularyOf is undefined for a skill that never heard of them', () => {
    expect(vocabularyOf(skill('plain'))).toBeUndefined();
  });

  it('vocabularyOf reads back exactly what was declared', () => {
    expect(
      vocabularyOf(skill('charting', { consumes: ['dataset/rows'], produces: ['chart/spec'] })),
    ).toEqual({ produces: ['chart/spec'], consumes: ['dataset/rows'] });
  });
});

// ═══ 5. Authoring refusals — teaching refusals at the declaration point ══════

describe('a malformed vocabulary is refused where it is written', () => {
  it('an empty array says nothing — omit the field', () => {
    expect(() => skill('x', { produces: [] })).toThrow(/declares nothing/);
  });

  it('a non-string kind is refused by name', () => {
    expect(() => skill('x', { produces: [42 as unknown as string] })).toThrow(
      /not an artifact kind/,
    );
  });

  it('a blank kind is refused', () => {
    expect(() => skill('x', { consumes: ['  '] })).toThrow(/not an artifact kind/);
  });

  it('a repeated kind is refused — a vocabulary is a SET', () => {
    expect(() => skill('x', { produces: ['a/b', 'a/b'] })).toThrow(/twice/);
  });

  it('the refusal names the skill it came from', () => {
    expect(() => skill('billing', { produces: [] })).toThrow(/defineSkill\(billing\)/);
  });

  it('a STEP declaration is refused at the same authoring point', () => {
    expect(() =>
      skill('x', {
        tools: [tool('t')] as never,
        steps: [{ tool: 't', note: 'n', produces: ['a/b', 'a/b'] }],
      }),
    ).toThrow(/step 1.*twice/s);
  });
});

// ═══ 6. Integration — through a real skillGraph checkup ═════════════════════

describe('integration: the code reaches the graph checkup', () => {
  const graph = (skills: Injection[]) => skillGraph({ skills, start: skills[0]!.id, check: 'off' });

  it('an unsatisfied kind surfaces as a checkup problem', () => {
    const g = graph([
      skill('charting', { consumes: ['dataset/rows'], tools: [tool('draw')] as never }),
    ]);
    expect(g.checkup().problems.map((p) => p.code)).toContain(UNSATISFIED);
  });

  it('it NEVER fails the checkup — ok stays true', () => {
    const g = graph([
      skill('charting', { consumes: ['dataset/rows'], tools: [tool('draw')] as never }),
    ]);
    expect(g.checkup().ok).toBe(true);
  });

  it('a graph whose skills declare nothing reports no vocabulary problems', () => {
    const g = graph([skill('a', { tools: [tool('t1')] as never })]);
    expect(g.checkup().problems.map((p) => p.code)).not.toContain(UNSATISFIED);
  });

  it('a producer on ANOTHER skill of the same graph silences it', () => {
    const g = graph([
      skill('charting', { consumes: ['dataset/rows'], tools: [tool('draw')] as never }),
      skill('fetching', { produces: ['dataset/rows'], tools: [tool('pull')] as never }),
    ]);
    expect(g.checkup().problems.map((p) => p.code)).not.toContain(UNSATISFIED);
  });
});

// ═══ 6b. Integration — the Agent build path (dev-mode warning, never a throw) ═

describe('integration: Agent.build() reports on the FINAL injection list', () => {
  const agentWith = (skills: Injection[]) => {
    let builder = Agent.create({
      provider: mock(),
      model: 'mock',
      artifacts: inMemoryArtifacts(),
    });
    for (const s of skills) builder = builder.skill(s);
    return builder;
  };

  it('a gap warns in dev mode — and the build still SUCCEEDS', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = agentWith([skill('charting', { consumes: ['dataset/rows'] })]).build();
    expect(agent).toBeDefined(); // never a throw: the rule cannot see enough to fail a build
    expect(warn.mock.calls.flat().join('\n')).toContain('artifact-kind-unsatisfied');
  });

  it('a producer reached only through ANOTHER door still silences it — the whole agent is visible here', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    agentWith([
      skill('charting', { consumes: ['dataset/rows'] }),
      skill('fetching', { produces: ['dataset/rows'] }),
    ]).build();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('artifact-kind-unsatisfied');
  });

  it('an agent whose skills declare NOTHING is silent — the zero-cost promise, end to end', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    agentWith([skill('a'), skill('b')]).build();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('artifact-kind-unsatisfied');
  });

  it('outside dev mode it says nothing at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    agentWith([skill('charting', { consumes: ['dataset/rows'] })]).build();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('artifact-kind-unsatisfied');
  });
});

// ═══ 7. Property / security / load ══════════════════════════════════════════

describe('property: a producer anywhere on the agent silences the check', () => {
  it('holds for every position of the producer in the list', () => {
    const consumer = skill('consumer', { consumes: ['k/1'] });
    for (let position = 0; position <= 3; position++) {
      const others = [skill('a'), skill('b'), skill('c')];
      others.splice(position, 0, skill('maker', { produces: ['k/1'] }));
      expect(codes([consumer, ...others])).toEqual([]);
    }
  });
});

describe('security: kinds are exact literals, never patterns', () => {
  it('a regex-looking producer does not satisfy a different consumer', () => {
    expect(
      codes([skill('c', { consumes: ['dataset/rows'] }), skill('p', { produces: ['.*'] })]),
    ).toEqual([UNSATISFIED]);
  });

  it('a prefix is not a match — "dataset" does not produce "dataset/rows"', () => {
    expect(
      codes([skill('c', { consumes: ['dataset/rows'] }), skill('p', { produces: ['dataset'] })]),
    ).toEqual([UNSATISFIED]);
  });

  it('matching is case-sensitive, like every other kind comparison in this library', () => {
    expect(
      codes([
        skill('c', { consumes: ['dataset/rows'] }),
        skill('p', { produces: ['Dataset/Rows'] }),
      ]),
    ).toEqual([UNSATISFIED]);
  });
});

describe('performance: the check scales to a large agent', () => {
  it('200 skills, one gap — found, and quickly', () => {
    const skills = Array.from({ length: 200 }, (_, i) => skill(`s${i}`, { produces: [`k/${i}`] }));
    skills.push(skill('gap', { consumes: ['k/absent'] }));
    const started = Date.now();
    expect(codes(skills)).toEqual([UNSATISFIED]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('200 skills that declare NOTHING short-circuit to []', () => {
    const skills = Array.from({ length: 200 }, (_, i) => skill(`s${i}`));
    expect(checkArtifactVocabularies(skills)).toEqual([]);
  });
});
