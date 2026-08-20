/**
 * unsupported-claim at the CLAIM seam — the answer's typed claims against
 * the run's settled facts (T8's shape).
 *
 * The evidence gate's own header names the hole this fills: "it cannot
 * catch a FALSE CLAIM ASSEMBLED FROM REAL VALUES". Typed facts make the
 * contradiction representable (semantics envelopes), a DECLARED contract
 * makes it decidable (`.claims()` — the operator names which answer fields
 * are claims about which ledger facts; the checker joins, never infers —
 * the argumentsFrom precedent).
 *
 * The fences carry the honesty: prose never fires (typed stratum only —
 * the check reads the schema-validated answer object); an uncollected fact
 * is UNREACHABLE, never an accusation; earlier ledger values are QUOTED
 * history (only the latest settled value asserts); a model that answers
 * null/'unknown' where the ledger holds a verified value gets an ADVISORY
 * (`advisory: true` — a softer class, counted apart), not a contradiction.
 *
 * Test types (Convention 3): unit (the pure check + every fence) /
 * contract (the declaration doors refuse malformed contracts) / functional
 * (the live loop: a contradicting answer files ONE finding; the honest
 * answer is silent; dispositions land on the run's rows).
 */

import { describe, expect, it } from 'vitest';
import { unsupportedClaimsOf } from '../../src/integrity/unsupported-claim/check.js';
import { Agent, defineTool } from '../../src/index.js';
import { semantic } from '../../src/lib/semantics/envelope.js';
import { mock } from '../../src/llm-providers.js';
import { unknown as unknownClaim } from '../../src/lib/claim/claim.js';
import { contextErrorIdentity, dedupeContextErrors } from '../../src/integrity/finding/types.js';

// ---------------------------------------------------------------------------
// The pure check
// ---------------------------------------------------------------------------

const declared = (answerField: string, entity: string, field: string) => ({
  answerField,
  entity,
  field,
});
const row = (
  entity: string,
  field: string,
  value: unknown,
  over: Record<string, unknown> = {},
) => ({
  entity,
  field,
  value,
  toolName: 'whats_here',
  toolCallId: 'c1',
  iteration: 1,
  ...over,
});

describe('unit: the contradiction, and every fence', () => {
  it('a typed claim contradicting the settled fact files one finding with both witnesses', () => {
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      [row('screen2', 'nav', 2)],
      { nav_count: 5 },
      7,
    );
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0]!;
    expect(f.kind).toBe('unsupported-claim');
    expect(f.seam).toBe('claim');
    expect(f.advisory).toBeUndefined();
    expect(f.subjects).toContainEqual({ kind: 'entity', id: 'screen2' });
    expect(f.witnesses.map((w) => w.stratum)).toContain('asserted');
    expect(f.message).toContain('nav_count');
    expect(out.dispositions).toEqual([{ claim: 'nav_count', disposition: 'checked-fail' }]);
  });

  it('the honest claim is a checked-pass, not silence', () => {
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      [row('screen2', 'nav', 2)],
      { nav_count: 2 },
      7,
    );
    expect(out.findings).toEqual([]);
    expect(out.dispositions).toEqual([{ claim: 'nav_count', disposition: 'checked-pass' }]);
  });

  it('only the LATEST settled value asserts — earlier rows are quoted history', () => {
    const ledger = [
      row('screen2', 'nav', 1, { iteration: 1 }),
      row('screen2', 'nav', 2, { iteration: 3 }),
    ];
    // Claiming the OLD value contradicts; the old row rides as a quoted witness.
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      ledger,
      { nav_count: 1 },
      7,
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.witnesses.some((w) => w.stratum === 'quoted')).toBe(true);
    // Claiming the LATEST passes.
    expect(
      unsupportedClaimsOf([declared('nav_count', 'screen2', 'nav')], ledger, { nav_count: 2 }, 7)
        .findings,
    ).toEqual([]);
  });

  it('an uncollected fact is UNREACHABLE — incomparable, never an accusation', () => {
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      [],
      { nav_count: 5 },
      7,
    );
    expect(out.findings).toEqual([]);
    expect(out.dispositions).toEqual([{ claim: 'nav_count', disposition: 'unreachable' }]);
  });

  it('a claim the answer omits is not-applicable — the schema allowed the absence', () => {
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      [row('screen2', 'nav', 2)],
      {},
      7,
    );
    expect(out.findings).toEqual([]);
    expect(out.dispositions).toEqual([{ claim: 'nav_count', disposition: 'not-applicable' }]);
  });

  it("null or 'unknown' against a verified value is an ADVISORY, counted apart", () => {
    for (const doubted of [null, 'unknown']) {
      const out = unsupportedClaimsOf(
        [declared('scope', 'run', 'scope')],
        [row('run', 'scope', 'verified')],
        { scope: doubted },
        7,
      );
      expect(out.findings).toHaveLength(1);
      expect(out.findings[0]!.advisory).toBe(true);
      // An advisory is not a contradiction: the disposition stays a pass.
      expect(out.dispositions).toEqual([{ claim: 'scope', disposition: 'checked-pass' }]);
    }
  });

  it('a ledger value that is an unknown Claim never compares — honest absence propagates', () => {
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      [row('screen2', 'nav', unknownClaim('meter offline'))],
      { nav_count: 5 },
      7,
    );
    expect(out.findings).toEqual([]);
    expect(out.dispositions).toEqual([{ claim: 'nav_count', disposition: 'unreachable' }]);
  });

  it('a number answered as its string is not a contradiction — stated leniency, one direction', () => {
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      [row('screen2', 'nav', 30)],
      { nav_count: '30' },
      7,
    );
    expect(out.findings).toEqual([]);
  });

  it('dot-paths read into the nested answer', () => {
    const out = unsupportedClaimsOf(
      [declared('report.nav_count', 'screen2', 'nav')],
      [row('screen2', 'nav', 2)],
      { report: { nav_count: 5 } },
      7,
    );
    expect(out.findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Through the live loop
// ---------------------------------------------------------------------------

const answerParser = { parse: (v: unknown) => v };

function screenTool() {
  return defineTool({
    name: 'whats_here',
    description: 'inspects the screen',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      semantic({
        facts: [{ entity: 'screen2', nav: 2 }],
        provenance: { measured_at: '2026-08-20T00:00:00Z', source: 'test-harness' },
      }),
  });
}

function claimAgent(finalAnswer: Record<string, unknown>) {
  const findings: Array<Record<string, unknown>> = [];
  const rows: Array<Record<string, unknown>> = [];
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'whats_here', args: {} }],
          stopReason: 'tool_use',
        },
        { content: JSON.stringify(finalAnswer), toolCalls: [], stopReason: 'stop' },
      ],
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('s')
    .tool(screenTool())
    .outputSchema(answerParser)
    .claims({ nav_count: { entity: 'screen2', field: 'nav' } })
    .build();
  agent.on('agentfootprint.integrity.context_error', (e) => {
    findings.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.integrity.disposition', (e) => {
    rows.push(...(e.payload as { rows: Array<Record<string, unknown>> }).rows);
  });
  return { agent, findings, rows };
}

describe('functional: the claim seam through the real loop', () => {
  it('a contradicting answer files ONE unsupported-claim at seam claim', async () => {
    const { agent, findings, rows } = claimAgent({ nav_count: 5 });
    await agent.run('how many navs?');
    const claims = findings.filter((f) => f.kind === 'unsupported-claim');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ seam: 'claim' });
    expect(String(claims[0]!.message)).toContain('nav_count');
    const claimRow = rows.find((r) => r.check === 'unsupported-claim');
    expect(claimRow).toMatchObject({ seam: 'claim' });
    expect(claimRow!.findings).toBe(1);
  });

  it('the honest answer is silent, and the disposition row says CHECKED', async () => {
    const { agent, findings, rows } = claimAgent({ nav_count: 2 });
    await agent.run('how many navs?');
    expect(findings.filter((f) => f.kind === 'unsupported-claim')).toEqual([]);
    const claimRow = rows.find((r) => r.check === 'unsupported-claim');
    expect(claimRow!.checked).toBeGreaterThanOrEqual(1);
    expect(claimRow!.findings).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The declaration doors
// ---------------------------------------------------------------------------

describe('contract: the doors refuse what nobody could have meant', () => {
  const base = () =>
    Agent.create({
      provider: mock({ replies: [{ content: 'x', toolCalls: [], stopReason: 'stop' }] }),
      model: 'mock',
    }).system('s');

  it('an empty contract is refused — omitting the call is how "no claims" is said', () => {
    expect(() => base().claims({})).toThrow(/claims/);
  });

  it('a blank entity or field joins the wrong subjects — refused, naming the key', () => {
    expect(() => base().claims({ nav: { entity: '', field: 'nav' } })).toThrow(/nav/);
    expect(() => base().claims({ nav: { entity: 'screen2', field: '' } })).toThrow(/nav/);
  });

  it('a second call would silently replace the first — refused', () => {
    const b = base().claims({ nav: { entity: 's', field: 'f' } });
    expect(() => b.claims({ other: { entity: 's', field: 'g' } })).toThrow(/already/);
  });

  it('claims without an output schema have no typed stratum to read — refused at build', () => {
    expect(() =>
      base()
        .claims({ nav: { entity: 's', field: 'f' } })
        .build(),
    ).toThrow(/outputSchema/);
  });
});

// ---------------------------------------------------------------------------
// Regressions from the adversarial review (each defect shipped, was caught,
// and is pinned here so it cannot come back)
// ---------------------------------------------------------------------------

describe('regression: two fields of one entity are two defects, not one', () => {
  it('the identity discriminates by field — both findings survive dedup', () => {
    const out = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav'), declared('tap_count', 'screen2', 'taps')],
      [row('screen2', 'nav', 2), row('screen2', 'taps', 7)],
      { nav_count: 5, tap_count: 9 },
      7,
    );
    expect(out.findings).toHaveLength(2);
    const ids = out.findings.map((f) => contextErrorIdentity({ ...f, epoch: undefined }));
    expect(new Set(ids).size).toBe(2);
    // …and the ledger's count agrees with what a consumer would receive.
    expect(dedupeContextErrors(out.findings)).toHaveLength(2);
    expect(out.dispositions.filter((d) => d.disposition === 'checked-fail')).toHaveLength(2);
  });

  it('an advisory never swallows a real contradiction about another field', () => {
    const out = unsupportedClaimsOf(
      [declared('scope', 'run', 'scope'), declared('count', 'run', 'count')],
      [row('run', 'scope', 'verified'), row('run', 'count', 2)],
      { scope: null, count: 99 },
      7,
    );
    expect(dedupeContextErrors(out.findings)).toHaveLength(2);
    const real = out.findings.filter((f) => f.advisory !== true);
    expect(real).toHaveLength(1);
    expect(real[0]!.message).toContain('count');
  });

  it('the SAME field re-detected still deduplicates to one', () => {
    const once = unsupportedClaimsOf(
      [declared('nav_count', 'screen2', 'nav')],
      [row('screen2', 'nav', 2)],
      { nav_count: 5 },
      7,
    );
    expect(dedupeContextErrors([...once.findings, ...once.findings])).toHaveLength(1);
  });
});

describe('regression: agreement on a doubted value is agreement, not doubt', () => {
  it('answering null where the run settled null files nothing', () => {
    const out = unsupportedClaimsOf(
      [declared('scope', 'run', 'scope')],
      [row('run', 'scope', null)],
      { scope: null },
      7,
    );
    expect(out.findings).toEqual([]);
    expect(out.dispositions).toEqual([{ claim: 'scope', disposition: 'checked-pass' }]);
  });

  it("and 'unknown' against a settled 'unknown' likewise", () => {
    const out = unsupportedClaimsOf(
      [declared('scope', 'run', 'scope')],
      [row('run', 'scope', 'unknown')],
      { scope: 'unknown' },
      7,
    );
    expect(out.findings).toEqual([]);
  });
});

describe('regression: the claim ledger is gated on a declared contract', () => {
  const semanticAgent = (withContract: boolean) => {
    let b = Agent.create({
      provider: mock({
        replies: [
          {
            content: '',
            toolCalls: [{ id: 'c1', name: 'whats_here', args: {} }],
            stopReason: 'tool_use',
          },
          { content: JSON.stringify({ nav_count: 2 }), toolCalls: [], stopReason: 'stop' },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .tool(screenTool())
      .outputSchema(answerParser);
    if (withContract) b = b.claims({ nav_count: { entity: 'screen2', field: 'nav' } });
    return b.build();
  };

  it('an agent with no contract commits no claimFacts — zero-delta', async () => {
    const agent = semanticAgent(false);
    await agent.run('how many navs?');
    const state = agent.getLastSnapshot()?.sharedState as { claimFacts?: unknown };
    expect(state.claimFacts).toBeUndefined();
  });

  it('an agent WITH a contract collects them', async () => {
    const agent = semanticAgent(true);
    await agent.run('how many navs?');
    const state = agent.getLastSnapshot()?.sharedState as { claimFacts?: readonly unknown[] };
    expect((state.claimFacts ?? []).length).toBeGreaterThan(0);
  });
});
