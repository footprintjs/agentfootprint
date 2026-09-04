/**
 * THREE LAWS, EACH STATED WHERE IT BINDS AND PINNED BY WHAT IT FORBIDS.
 *
 * ── Why both halves ──────────────────────────────────────────────────────
 * A `STATED:` test proves a SENTENCE still exists in the source. That is all
 * it does. It enforces no behaviour, and a reader who mistakes one for
 * enforcement has been told a law is guarded when only its docstring is. The
 * repo has three of them already (tool-effects, tools-from-active-skill,
 * silent-success) and every one guards a sentence a reader would otherwise
 * trust for something the code does not do.
 *
 * So each law here gets both: a `STATED:` pin so the sentence cannot quietly
 * go missing, and behavioural counterexamples — real runs — that go red when
 * the behaviour regresses, whatever the docstring says.
 *
 * ── The three ────────────────────────────────────────────────────────────
 *  1. THE CAPABILITY LAW (src/core/agent/buildToolRegistry.ts) — for one
 *     epoch: everything offered dispatches, with stable identity; attention
 *     may alter the offer; omission is not proof of permanent loss. Clause
 *     one is SCOPED to the tools that file routes, and its exception is the
 *     shadow seam — pinned as a counterexample by (g), because a law whose
 *     exception is unpinned is a law a reader will over-read.
 *  2. THE LENS LAW (src/lib/injection-engine/skillToolDescriptors.ts) — a
 *     Lens may omit; it may claim absence or refusal only from authoritative
 *     evidence for the epoch it describes.
 *  3. THE CURSOR LAW (src/core/agent/stages/routeTurn.ts) — position belongs
 *     to the host and the trace, never to the transcript.
 *
 * ── What an EPOCH is here ────────────────────────────────────────────────
 * One composed request plus the dispatch of the tool calls it comes back
 * with. `offers[i]` is epoch i's offer (captured off the wire); a tool that
 * appended its own name to `ran` during that epoch dispatched in it.
 *
 * Test types: integration (every counterexample is a real agent run) /
 * documentation (the three STATED pins) / security-containment (law 1(d),
 * where narrowing DOES reach dispatch and must not be over-promised) /
 * regression (law 1(g), the same-epoch identity divergence the framework
 * reports rather than refuses).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { Agent, defineTool } from '../../../src/index.js';
import { defineSkill, skillGraph, decideSkill } from '../../../src/injection-engine.js';
import { skillScopedTools, staticTools } from '../../../src/tool-providers/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest } from '../../../src/adapters/types.js';
import {
  readSkillDescriptor,
  type ReadSkillOffer,
} from '../../../src/lib/injection-engine/skillToolDescriptors.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/** A tool that records its own dispatch. Presence in `log` IS "it ran". */
const recordingTool = (name: string, log: string[]) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      log.push(name);
      return `${name} ran`;
    },
  });

/**
 * A tool whose CONTRACT and whose IMPLEMENTATION carry the same stamp.
 *
 * A name cannot witness stable identity, because a name is exactly what two
 * different functions can share — that is the shadow seam in (g). So the
 * description the model reads and the result the dispatch returns are stamped
 * with one token, and whatever answers a call has to say which contract it is.
 */
const stampedTool = (name: string, stamp: string, log: string[]) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool [contract:${stamp}]`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      log.push(name);
      return `${name} ran [impl:${stamp}]`;
    },
  });

const stampOf = (text: string, kind: 'contract' | 'impl'): string | undefined =>
  new RegExp(`\\[${kind}:([^\\]]+)\\]`).exec(text)?.[1];

/**
 * Every offered name whose ANSWER came from a different tool than the contract
 * offered under that name in the same epoch. `[]` is stable identity.
 *
 * Unstamped names (`read_skill`, `skip_step` — the framework's own) are not
 * compared: nothing stamped them, so there is no contract token to compare
 * against, and asserting on them would be asserting on their absence.
 */
const identityDivergences = (
  offered: readonly { readonly name: string; readonly description: string }[],
  answerByName: ReadonlyMap<string, string>,
): string[] =>
  offered
    .filter((t) => stampOf(t.description, 'contract') !== undefined)
    .filter(
      (t) => stampOf(answerByName.get(t.name) ?? '', 'impl') !== stampOf(t.description, 'contract'),
    )
    .map((t) => t.name);

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});

const FINAL = { content: 'done', toolCalls: [], stopReason: 'stop' as const };

/**
 * A provider that answers a script AND snapshots each request's offer.
 *
 * Snapshotted, never referenced: the framework reuses the `LLMRequest` object
 * across iterations, so holding it and reading `.tools` afterwards reports the
 * LAST epoch's offer for every entry — which looks exactly like the feature
 * never working.
 */
const scripted = (script: readonly unknown[], offers: string[][]) =>
  mock({
    respond: (req: LLMRequest) => {
      offers.push((req.tools ?? []).map((t) => t.name));
      return (script[offers.length - 1] ?? FINAL) as never;
    },
  });

/** Every tool result the run delivered, in dispatch order. */
const resultsOf = (agent: Agent): string[] => {
  const out: string[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) =>
    out.push(String((e.payload as { result?: unknown }).result)),
  );
  return out;
};

const read = (path: string): string =>
  readFileSync(new URL(`../../../src/${path}`, import.meta.url), 'utf8');

// ═════════════════════════════════════════════════════════════════════════
// LAW 1 — the capability law, epoch-scoped
// ═════════════════════════════════════════════════════════════════════════

describe('LAW 1 — the capability law, epoch-scoped', () => {
  it('STATED: the law is written where the offer and the dispatch map are built', () => {
    // buildToolRegistry returns BOTH maps, so it is the one file where a
    // reader can see that they are different sets and ask why. A law stated
    // anywhere else is a law they meet after they have already assumed one.
    const src = read('core/agent/buildToolRegistry.ts');
    expect(src).toContain('every offered capability resolves to a dispatchable implementation');
    expect(src).toContain('the offer must NOT be presented as proof of permanent capability loss.');
    // And the qualification, which is the half three earlier drafts dropped.
    expect(src).toContain('Same-epoch offer implies same-epoch dispatch');
    // Clause one is SCOPED. Round 2 of this phase found the unscoped reading
    // false in a shipped configuration: the wire list is merged one layer out
    // in `buildToolsSlot` and carries provider schemas these maps never hold.
    expect(src).toContain('scoped to THE TOOLS THIS FILE ROUTES');
    // …and the illustration of what clause one does NOT cover has to name the
    // seam. It is no longer the whole set — the set is walked by
    // `toolDivergenceWalk.test.ts`, and the comment now says so — but a reader
    // meeting these two maps for the first time has to leave with at least one
    // concrete counterexample in hand, or the scoping above reads as a
    // formality rather than as the thing that makes the clause true.
    expect(src).toContain('The SHADOW SEAM');
    // And the pointer itself: a list that stopped claiming completeness has to
    // say where completeness now lives, or it is just a shorter wrong list.
    expect(src).toContain('THE ENUMERATION IS `test/core/agent/toolDivergenceWalk.test.ts`');
  });

  // ── (a) flat-graph tool scoping ────────────────────────────────────────

  it('(a) flat graph: a tool scoped OUT of the offer still dispatches when the model names it', async () => {
    const ran: string[] = [];
    const triage = defineSkill({
      id: 'triage',
      description: 'triage a request',
      body: 'TRIAGE BODY',
      tools: [recordingTool('triage_tool', ran)] as never,
    });
    const billing = defineSkill({
      id: 'billing',
      description: 'billing questions',
      body: 'BILLING BODY',
      tools: [recordingTool('billing_tool', ran)] as never,
    });
    const graph = skillGraph({
      skills: [triage, billing],
      start: 'triage',
      steps: [{ from: 'triage', to: 'billing', onToolReturn: 'triage_tool' }],
      scopeTools: true,
      check: 'off',
    });
    const offers: string[][] = [];
    const agent = Agent.create({
      provider: scripted([call('billing_tool', 't1')], offers),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const results = resultsOf(agent);
    await agent.run({ message: 'hello' });

    // The cursor is on triage, so billing's tool is not on the wire…
    expect(offers[0]).not.toContain('billing_tool');
    // …and naming it anyway runs it. This is the case the law's first clause
    // is safe on: the implementation lives in `registryByName`, which the
    // scoping never touched.
    expect(ran).toEqual(['billing_tool']);
    expect(results[0]).toBe('billing_tool ran');
  });

  // ── (b) the .tree() arm, which nothing covered ─────────────────────────

  it('(b) .tree(): the same assertion on the arm with no cursor at all', async () => {
    const ran: string[] = [];
    const alpha = defineSkill({
      id: 'alpha',
      description: 'alpha leaf',
      body: 'ALPHA BODY',
      tools: [recordingTool('alpha_tool', ran)] as never,
    });
    const beta = defineSkill({
      id: 'beta',
      description: 'beta leaf',
      body: 'BETA BODY',
      tools: [recordingTool('beta_tool', ran)] as never,
    });
    const graph = skillGraph({
      skills: [alpha, beta],
      // Tree mode scopes tools by default — each leaf's tools ride only while
      // the predicate routes to it.
      tree: decideSkill((ctx) => ctx.userMessage.includes('alpha'), alpha, beta),
      check: 'off',
    });
    const offers: string[][] = [];
    const agent = Agent.create({
      provider: scripted([call('beta_tool', 't1')], offers),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const results = resultsOf(agent);
    await agent.run({ message: 'take the alpha branch' });

    expect(offers[0]).toContain('alpha_tool');
    expect(offers[0]).not.toContain('beta_tool');
    // Worth stating plainly, because a tree is the arm where `read_skill`
    // recovery is EMPTY by construction: the offer is the only route back to
    // the losing leaf's tools, and it is still not a dispatch gate.
    expect(ran).toEqual(['beta_tool']);
    expect(results[0]).toBe('beta_tool ran');
  });

  // ── (c) the two hold-outs ──────────────────────────────────────────────

  it('(c1) park hold-out: a parked map’s tool leaves the wire and stays dispatchable', async () => {
    const ran: string[] = [];
    const zoneAudit = defineSkill({
      id: 'zone-audit',
      description: 'audit zone redundancy',
      body: 'ZONE AUDIT PROCEDURE',
      tools: [recordingTool('get_zone_info', ran)] as never,
    });
    const billing = defineSkill({ id: 'billing', description: 'billing questions', body: 'B' });
    const graph = skillGraph()
      .entry(zoneAudit, { match: { keywords: ['zone'] } })
      .route(zoneAudit, billing)
      .build();
    const offers: string[][] = [];
    const agent = Agent.create({
      provider: scripted(
        [
          // Three passes calling something ELSE — the idle count the kernel parks on.
          call('screen_open', 'c1'),
          call('screen_open', 'c2'),
          call('screen_open', 'c3'),
          // Pass 4 is the parked one. The model reaches for the parked tool.
          call('get_zone_info', 'c4'),
        ],
        offers,
      ),
      model: 'mock',
      maxIterations: 8,
    })
      .system('s')
      .tool(recordingTool('screen_open', ran))
      .skillGraph(graph)
      .maps({ renewalGrace: 3 })
      .build();
    const results = resultsOf(agent);
    await agent.run({ message: 'find the most recent zone redundancy run' });

    expect(offers[0]).toContain('get_zone_info');
    expect(offers[3]).not.toContain('get_zone_info');
    expect(ran).toContain('get_zone_info');
    expect(results.at(-1)).toBe('get_zone_info ran');
  });

  it('(c2) step hold-out: a later step’s tool is off the offer and still dispatches', async () => {
    const ran: string[] = [];
    const refund = defineSkill({
      id: 'refund',
      description: 'refund handling',
      body: 'Handle refunds carefully.',
      tools: [
        recordingTool('lookup', ran),
        recordingTool('charge', ran),
        recordingTool('export_receipt', ran),
      ] as never,
      steps: [
        { tool: 'lookup', note: 'find the order first' },
        { tool: 'charge', note: 'refund the charge' },
        { tool: 'export_receipt', note: 'file the receipt' },
      ],
    });
    const offers: string[][] = [];
    const agent = Agent.create({
      provider: scripted(
        [
          call('read_skill', 't1', { id: 'refund' }),
          // The tenure is open at step 1 (`lookup`). The model jumps to step 3.
          call('export_receipt', 't2'),
        ],
        offers,
      ),
      model: 'mock',
      maxIterations: 6,
    })
      .system('s')
      .skill(refund)
      .build();
    const results = resultsOf(agent);
    await agent.run({ message: 'refund order 42' }).catch(() => undefined);

    // Epoch 2 is the tenure iteration: narrowed to the current step.
    expect(offers[1]).toContain('lookup');
    expect(offers[1]).not.toContain('export_receipt');
    expect(ran).toContain('export_receipt');
    expect(results.some((r) => r === 'export_receipt ran')).toBe(true);
  });

  // ── (d) the case that falsified the additive claim ─────────────────────

  it('(d) provider-backed tools: same-epoch offer implies same-epoch dispatch — and NOT a byte more', async () => {
    const ran: string[] = [];
    const billing = defineSkill({ id: 'billing', description: 'billing questions', body: 'B' });
    const offers: string[][] = [];
    const agent = Agent.create({
      provider: scripted(
        [
          // Epoch 1 — nothing activated, so the provider serves nothing.
          call('refund_tool', 't1'),
          // Epoch 2 — take the only door that sets `ctx.activeSkillId`.
          call('read_skill', 't2', { id: 'billing' }),
          // Epoch 3 — billing is the activation, so the provider serves it.
          call('refund_tool', 't3'),
        ],
        offers,
      ),
      model: 'mock',
      maxIterations: 6,
    })
      .system('s')
      .skill(billing)
      .toolProvider(skillScopedTools('billing', [recordingTool('refund_tool', ran)]))
      .build();
    const results = resultsOf(agent);
    await agent.run({ message: 'go' });

    // THE FALSIFIER. Out of the offer here means out of DISPATCH here: the
    // implementation is resolved from the cache the Tools slot overwrites with
    // this epoch's `provider.list(ctx)`, so there is nothing to look up.
    expect(offers[0]).not.toContain('refund_tool');
    expect(results[0]).toContain('Unknown tool');

    // What IS true, asserted as the law states it: offered in E ⇒ dispatchable
    // in E. Epoch 3 offers it and epoch 3 runs it.
    expect(offers[2]).toContain('refund_tool');
    expect(results.at(-1)).toBe('refund_tool ran');
    // ONE dispatch across three epochs, from the epoch that offered it. The
    // length is the assertion: had epoch 1 resolved it too, this would be two.
    expect(ran).toEqual(['refund_tool']);
  });

  // ── (e) a restored transcript naming a held-out tool ───────────────────

  it('(e) after a resume: a tool named from RESTORED history dispatches though it is not offered', async () => {
    const ran: string[] = [];
    const triage = defineSkill({
      id: 'triage',
      description: 'triage a request',
      body: 'TRIAGE BODY',
      tools: [recordingTool('triage_tool', ran)] as never,
    });
    const billing = defineSkill({
      id: 'billing',
      description: 'billing questions',
      body: 'BILLING BODY',
      tools: [recordingTool('billing_tool', ran)] as never,
    });
    const graph = () =>
      skillGraph({
        skills: [triage, billing],
        start: 'triage',
        steps: [{ from: 'triage', to: 'billing', onToolReturn: 'triage_tool' }],
        scopeTools: true,
        check: 'off',
      });

    const firstOffers: string[][] = [];
    const first = Agent.create({
      provider: scripted(
        [call('read_skill', 't1', { id: 'billing' }), call('billing_tool', 't2')],
        firstOffers,
      ),
      model: 'mock',
      maxIterations: 6,
    })
      .system('s')
      .skillGraph(graph())
      .build();
    await first.run({ message: 'a billing question' });
    const checkpoint = JSON.parse(JSON.stringify(first.checkpoint()));
    expect(ran).toContain('billing_tool');

    // Turn two, same conversation, restored. The transcript still holds the
    // billing_tool call and its result; the cursor does not come with it.
    ran.length = 0;
    const secondOffers: string[][] = [];
    const second = Agent.create({
      provider: scripted([call('billing_tool', 't3')], secondOffers),
      model: 'mock',
      maxIterations: 6,
    })
      .system('s')
      .skillGraph(graph())
      .build();
    const results = resultsOf(second);
    await second.run({ message: 'one more thing', continueFrom: checkpoint });

    expect(secondOffers[0]).not.toContain('billing_tool');
    expect(ran).toEqual(['billing_tool']);
    expect(results.at(-1)).toBe('billing_tool ran');
  });

  // ── (f) the law's positive clause, on the whole offer ──────────────────

  it('(f) same-epoch identity: every name offered in an epoch is answered by the tool whose contract it offered', async () => {
    const ran: string[] = [];
    const triage = defineSkill({
      id: 'triage',
      description: 'triage a request',
      body: 'TRIAGE BODY',
      tools: [stampedTool('triage_tool', 'triage-skill', ran)] as never,
    });
    const billing = defineSkill({
      id: 'billing',
      description: 'billing questions',
      body: 'BILLING BODY',
      tools: [stampedTool('billing_tool', 'billing-skill', ran)] as never,
    });
    const graph = skillGraph({
      skills: [triage, billing],
      start: 'triage',
      steps: [{ from: 'triage', to: 'billing', onToolReturn: 'triage_tool' }],
      scopeTools: true,
      check: 'off',
    });

    // Three sources at once — static `.tool()`, a scoped graph, a provider —
    // so the epoch's offer is genuinely assembled rather than one list.
    //
    // Descriptions are captured, not only names. The offer is what the model
    // READS, and a name says nothing about which implementation stands behind
    // it — checking names alone is what let this test stay green through the
    // shadow seam that (g) now pins.
    const offers: { name: string; description: string }[][] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (req: LLMRequest) => {
          const offer = (req.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description,
          }));
          const names = offer.map((t) => t.name);
          offers.push(offer);
          if (offers.length > 1) return FINAL as never;
          // Call EVERY offered name, with the call id set to the name so the
          // results can be attributed back.
          return {
            content: '',
            toolCalls: names.map((n) => ({
              id: n,
              name: n,
              args: n === 'read_skill' ? { id: 'billing' } : {},
            })),
            stopReason: 'tool_use',
          } as never;
        },
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .tool(stampedTool('calc', 'static-registry', ran))
      .skillGraph(graph)
      .toolProvider(staticTools([stampedTool('probe', 'provider', ran)]))
      .build();

    const byCallId = new Map<string, string>();
    agent.on('agentfootprint.stream.tool_end', (e) => {
      const p = e.payload as { toolCallId?: string; result?: unknown };
      byCallId.set(String(p.toolCallId), String(p.result));
    });
    await agent.run({ message: 'hello' });

    const offered = offers[0] ?? [];
    expect(offered.length).toBeGreaterThan(2);
    for (const { name } of offered) {
      // Dispatchable: the name resolved to an implementation. `Unknown tool`
      // is the framework's own word for "offered and not routable".
      expect(byCallId.has(name), `${name} produced no result`).toBe(true);
      expect(byCallId.get(name), name).not.toContain('Unknown tool');
    }
    // Stable identity — the clause, not its shadow. `ran` still proves each
    // tool dispatched under its own name, and the stamps prove the answer came
    // from the implementation whose contract the SAME epoch offered. Only the
    // second half can fail while the first passes, which is precisely the
    // shipped configuration (g) reproduces.
    for (const { name } of offered.filter((t) => stampOf(t.description, 'contract'))) {
      expect(ran, name).toContain(name);
    }
    expect(identityDivergences(offered, byCallId)).toEqual([]);
  });

  // ── (g) the exception the law now enumerates ───────────────────────────

  it('(g) COUNTEREXAMPLE — the shadow seam: identity diverges inside one epoch, and is reported', async () => {
    // The law's clause one is scoped to the tools `buildToolRegistry` routes.
    // The OFFER is wider than those maps: `buildToolsSlot` merges
    // `[static, provider, skill, step]` first-occurrence-wins, so a provider
    // schema reaches the wire ahead of an active skill's tool of the same
    // name while `lookupTool` still resolves the skill's `execute`. The model
    // reads one contract and calls another implementation, in ONE epoch.
    //
    // This is deliberate and documented (`reportShadowedTools`), and the fix
    // is not available at build time: the provider's list is resolved per
    // iteration and the skill has to be active. So the framework reports it.
    // The test's job is to keep it REPORTED rather than let it become quiet:
    // if the event stops firing, the seam is a silent lie again.
    const ran: string[] = [];
    const skillSide = stampedTool('shared_tool', 'skill', ran);
    const providerSide = stampedTool('shared_tool', 'provider', ran);
    const billing = defineSkill({
      id: 'billing',
      description: 'billing questions',
      body: 'BILLING BODY',
      tools: [skillSide] as never,
    });

    const offers: { name: string; description: string }[][] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (req: LLMRequest) => {
          offers.push((req.tools ?? []).map((t) => ({ name: t.name, description: t.description })));
          // Epoch 1 activates the skill; epoch 2 is the one where both sources
          // claim the name, so it is the epoch the law is read against.
          if (offers.length === 1)
            return call('read_skill', 'read_skill', { id: 'billing' }) as never;
          if (offers.length === 2) return call('shared_tool', 'shared_tool') as never;
          return FINAL as never;
        },
      }),
      model: 'mock',
      maxIterations: 5,
    })
      .system('s')
      .skills({ list: () => [billing] })
      .toolsFromActiveSkill()
      .toolProvider(staticTools([providerSide]))
      .build();

    const byCallId = new Map<string, string>();
    const shadowed: { toolName: string; schemaFrom: string; dispatchTo: string }[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) => {
      const p = e.payload as { toolCallId?: string; result?: unknown };
      byCallId.set(String(p.toolCallId), String(p.result));
    });
    agent.on('agentfootprint.tools.shadowed', (e) =>
      shadowed.push(
        e.payload as unknown as { toolName: string; schemaFrom: string; dispatchTo: string },
      ),
    );
    await agent.run({ message: 'hello' });

    const epoch = offers[1] ?? [];
    const shared = epoch.find((t) => t.name === 'shared_tool');
    // Clause one's DISPATCHABILITY half survives: the name resolves, and the
    // framework's word for a name it cannot route never appears.
    expect(byCallId.get('shared_tool')).toBeDefined();
    expect(byCallId.get('shared_tool')).not.toContain('Unknown tool');
    // The IDENTITY half does not. The wire carried the provider's contract…
    expect(stampOf(shared?.description ?? '', 'contract')).toBe('provider');
    // …and the skill's implementation answered it.
    expect(stampOf(byCallId.get('shared_tool') ?? '', 'impl')).toBe('skill');
    // Which is exactly what (f)'s assertion measures — here it names the seam
    // instead of returning empty, so the strengthened guard is proven to see a
    // divergence rather than merely to pass on a fixture that has none.
    expect(identityDivergences(epoch, byCallId)).toEqual(['shared_tool']);
    // Reported, not refused: nothing threw, and the epoch is on the record
    // naming which source won which race.
    expect(shadowed.some((e) => e.toolName === 'shared_tool')).toBe(true);
    expect(shadowed[0]?.schemaFrom).toBe('provider');
    expect(shadowed[0]?.dispatchTo).toBe('skill');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// LAW 2 — the Lens law
// ═════════════════════════════════════════════════════════════════════════

describe('LAW 2 — a Lens may omit; absence and refusal need evidence for the epoch', () => {
  const skills = [
    defineSkill({ id: 'alpha', description: 'alpha does things', body: 'ALPHA_BODY' }),
    defineSkill({ id: 'beta', description: 'beta does things', body: 'BETA_BODY' }),
    defineSkill({ id: 'gamma', description: 'gamma does things', body: 'GAMMA_BODY' }),
  ];
  const describe_ = (offer?: ReadSkillOffer): string =>
    readSkillDescriptor(skills, offer)?.description ?? '';

  /** Vocabulary that turns "not offered here" into "does not exist". */
  const ABSENCE = [
    /does not exist/i,
    /no such skill/i,
    /\bunavailable\b/i,
    /\bis gone\b/i,
    /you do not have/i,
    /\bnot available\b/i,
  ];
  const absenceClaims = (text: string): string[] =>
    ABSENCE.filter((re) => re.test(text)).map((re) => re.source);

  it('STATED: the law is written at the composition site that both omits and refuses', () => {
    // `describeOffer` is the only site doing both halves: `hiddenIds` omits,
    // and the second column predicts a refusal. Everywhere else does one.
    const src = read('lib/injection-engine/skillToolDescriptors.ts');
    expect(src).toContain(
      'A Lens may omit; it may claim absence or refusal only from authoritative',
    );
    expect(src).toContain('ABSENCE is a CLAIM, and a claim needs evidence for THIS epoch.');
  });

  it('the refusal column is CURSOR-RELATIVE — "not reachable from here", never "does not exist"', () => {
    const text = describe_({ grantable: ['beta'], showRefusable: true, cursorId: 'alpha' });
    expect(text).toContain('Not reachable from here');
    // Named, so the model can route to it in one step — the opposite of the
    // failure this area exists for.
    expect(text).toContain('gamma');
    expect(absenceClaims(text)).toEqual([]);
  });

  it('the dead-end arm says it about HERE, not about the catalog', () => {
    const text = describe_({ grantable: [], showRefusable: true, cursorId: 'alpha' });
    expect(text).toContain('Nothing is reachable from here');
    expect(absenceClaims(text)).toEqual([]);
  });

  it('a role-hidden skill is OMITTED, not declared absent — silence costs nothing, a claim costs evidence', () => {
    const text = describe_({
      grantable: ['gamma'],
      showRefusable: true,
      cursorId: 'alpha',
      hiddenIds: ['beta'],
    });
    // Not as reachable, not as refusable, not named at all…
    expect(text).not.toContain('beta');
    // …and no sentence anywhere asserting that it is not there. Omission is
    // the whole mechanism: a claim about beta would teach this role the shape
    // of a permission it will never be granted.
    expect(absenceClaims(text)).toEqual([]);
  });

  it('the plain catalog with everything hidden says what it CAN say, and nothing more', () => {
    const text = describe_({ hiddenIds: ['alpha', 'beta', 'gamma'] });
    expect(text).toContain('No skills are available to you');
    // "available to YOU" is a statement about this caller's own offer, which
    // the resolver is authoritative for. It is the one absence sentence the
    // Lens holds evidence for, so it is the one it may make.
    expect(text).not.toMatch(/does not exist|no such skill/i);
  });

  it('the GATE’s refusal of a real call is epoch-anchored too, and names what IS reachable', async () => {
    const triage = defineSkill({ id: 'triage', description: 'triage', body: 'T' });
    const billing = defineSkill({ id: 'billing', description: 'billing', body: 'B' });
    const vault = defineSkill({ id: 'vault', description: 'vault', body: 'V' });
    // `vault` is WIRED — a node two hops away, not an open skill registered
    // beside the graph. An open skill is admitted from any cursor, so it would
    // be granted here and there would be no refusal to read.
    const graph = skillGraph().entry(triage).route(triage, billing).route(billing, vault).build();
    const agent = Agent.create({
      provider: mock({
        replies: [call('read_skill', 't1', { id: 'vault' }), FINAL] as never,
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const results = resultsOf(agent);
    await agent.run({ message: 'hello' });

    const refusal = results[0] ?? '';
    // The refusal is about HERE. A registered skill the cursor cannot reach is
    // still a skill that exists, and the message must not read otherwise.
    expect(refusal).toContain('is not reachable from here');
    expect(refusal).toContain('billing');
    expect(absenceClaims(refusal)).toEqual([]);
  });

  it('under a tree the refusal explains the TREE — the honest reason, not a false "from here"', async () => {
    const leafA = defineSkill({ id: 'leaf-a', description: 'leaf a', body: 'A' });
    const leafB = defineSkill({ id: 'leaf-b', description: 'leaf b', body: 'B' });
    const graph = skillGraph({
      skills: [leafA, leafB],
      tree: decideSkill(() => true, leafA, leafB),
      check: 'off',
    });
    const agent = Agent.create({
      provider: mock({
        replies: [call('read_skill', 't1', { id: 'leaf-b' }), FINAL] as never,
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .skillGraph(graph)
      .build();
    const results = resultsOf(agent);
    await agent.run({ message: 'hello' });

    const refusal = results[0] ?? '';
    // "No skills are reachable from here" would invite a retry from somewhere
    // else, and a tree has no elsewhere. So the message states the mechanism —
    // which is the evidence the composer actually holds.
    expect(refusal).toContain('cannot move a decision tree');
    expect(refusal).toContain('routes by predicate');
    expect(absenceClaims(refusal)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// LAW 3 — the cursor law
// ═════════════════════════════════════════════════════════════════════════

describe('LAW 3 — position belongs to the host and the trace, never to the transcript', () => {
  const graphWith = (ids: readonly string[]) => {
    const skills = ids.map((id) =>
      defineSkill({ id, description: `${id} desk`, body: `${id.toUpperCase()} BODY` }),
    );
    let g = skillGraph().entry(skills[0]!, { match: { keywords: ['refund'] } });
    for (const s of skills.slice(1)) g = g.entry(s);
    return g.build();
  };

  it('STATED: the law is written on the clause that implements its hardest part', () => {
    const src = read('core/agent/stages/routeTurn.ts');
    expect(src).toContain('Position belongs to the HOST and the TRACE, never to the transcript.');
    // The clause itself, which shipped implemented and unnamed.
    expect(src).toContain('never silently parked');
  });

  it('an inherited cursor the mounted graph does not know is DROPPED, recorded, and started COLD', async () => {
    const routed: Array<Record<string, unknown>> = [];
    const recorder = {
      id: 'law3',
      onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.skill.turn_routed') routed.push(e.payload ?? {});
      },
    };
    const agent = Agent.create({
      provider: mock({ reply: 'answered' }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graphWith(['refunds', 'shipping']), { continuity: 'conversation' })
      .watch(recorder)
      .build();

    await agent.run({ message: 'please refund my order' });
    const checkpoint = agent.checkpoint()!;
    expect((checkpoint as { skillCursor?: string }).skillCursor).toBe('refunds');

    // A deploy retired the node this conversation was standing on.
    const stale = { ...checkpoint, skillCursor: 'retired-skill' };
    await agent.run({ message: 'please refund my order', continueFrom: stale });

    const second = routed.at(-1)!;
    // The TRACE keeps the fact — a position silently discarded is one nobody
    // can audit afterwards.
    expect(second.droppedResume).toEqual({ id: 'retired-skill', reason: 'unknown-skill' });
    // COLD, not parked on a node no resolver can move off.
    expect(second.from).toBeUndefined();
  });

  it('the TRANSCRIPT cannot restore position: a retired skill all over history stays dropped', async () => {
    const routed: Array<Record<string, unknown>> = [];
    const recorder = {
      id: 'law3-transcript',
      onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.skill.turn_routed') routed.push(e.payload ?? {});
      },
    };
    const agent = Agent.create({
      provider: mock({ reply: 'answered' }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .skillGraph(graphWith(['refunds', 'shipping']), { continuity: 'conversation' })
      .watch(recorder)
      .build();
    await agent.run({ message: 'please refund my order' });

    // The conversation a real deploy leaves behind: the retired skill named as
    // activated, its body quoted back, its tool answering. Every one of these
    // is the kind of sentence a resume-from-history reader would trust.
    const checkpoint = agent.checkpoint()! as { skillCursor?: string; history?: unknown[] };
    const stale = {
      ...checkpoint,
      skillCursor: 'retired-skill',
      history: [
        ...(checkpoint.history ?? []),
        { role: 'assistant', content: "Skill 'retired-skill' activated for the next iteration." },
        { role: 'user', content: 'stay in retired-skill please' },
      ],
    };
    await agent.run({ message: 'carry on', continueFrom: stale });

    const second = routed.at(-1)!;
    expect(second.droppedResume).toEqual({ id: 'retired-skill', reason: 'unknown-skill' });
    expect(second.from).toBeUndefined();
    // And nothing downstream picked the name up off the transcript either.
    expect(second.to).not.toBe('retired-skill');
  });
});
