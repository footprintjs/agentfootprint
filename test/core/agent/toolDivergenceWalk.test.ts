/**
 * THE DIVERGENCE WALK — a DISCOVERED enumeration of every place the tool OFFER
 * and the tool DISPATCH can disagree.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `buildToolRegistry.ts` used to carry a hand-written list of the seams where
 * the schema the model reads and the implementation that answers can come
 * apart, and the list presented itself as complete. It was wrong three times
 * in three rounds — each round stated it more precisely, and each round an
 * independent check found one more:
 *
 *   round 1  provider tools vanish cross-epoch
 *   round 2  provider/skill name shadow, same epoch
 *   round 3  an INACTIVE skill shadows silently; `skip_step` shadowable by a provider
 *
 * A hand-maintained list claiming completeness is the exact defect this
 * library exists to fix, one level up: a sentence a reader trusts, kept true
 * by nobody. So the enumeration is no longer written. It is WALKED.
 *
 * ── What the walk does ───────────────────────────────────────────────────
 *
 * `CLAIMANTS` is every source that can put a name on the wire or answer to
 * one. `crossEpochCases` is every narrowing that can take a name off the wire
 * mid-run. `frameworkCases` is every name the framework attaches to itself.
 * The walk crosses them, drives a REAL agent run per configuration, and
 * records, per epoch: what name was offered, what CONTRACT was on the wire,
 * what IMPLEMENTATION answered, and whether `agentfootprint.tools.shadowed`
 * fired and what it claimed.
 *
 * The case count is arithmetic, not a number anybody keeps:
 *
 *   walk A  every ORDERED pair of distinct claimants   7 × 6      = 42
 *   walk B  the narrowings, hand-listed                            =  6
 *   walk C  every claimant × every auto-attach name    7 × 4      = 28
 *                                                                 ────
 *                                                                    76
 *
 * `AF_DIVERGENCE_BASELINE=update` writes the realised counts into the
 * baseline's `walk` block, and `walk.cases` is the one to read: adding a
 * claimant moves it by 2·(n−1) + 4 without anybody editing this comment. A
 * count stated here and nowhere else is the same defect this file exists to
 * fix, so the sum above is a derivation a reader can check, not a total to
 * trust.
 *
 * Every tool it mounts carries the same token in its description and in its
 * result — `[contract:X]` and `[impl:X]`. A name cannot witness identity,
 * because a name is exactly what two implementations can share; a stamp can.
 * Whatever answers a call has to say which contract it was.
 *
 * ── What it found that nobody had written down ───────────────────────────
 *
 * The walk was seeded with the five known divergences and reproduced all five
 * from its own runs. It then found more, which is the entire point of building
 * it — every one of these was reachable in a shipped configuration and named
 * in no comment:
 *
 *   • A provider tool whose name a REGISTRY-LIST holder already owns loses the
 *     wire AND dispatch and is simply dead — a static `.tool()`, an
 *     always-visible skill tool, a stepped skill's tool, or one of the
 *     framework's own auto-attached names. `reportShadowedTools` cannot see it:
 *     it fires only when a provider schema SURVIVED the merge.
 *   • The three framework auto-attach names disagree with each other. A skill
 *     tool called `read_skill` under `.toolsFromActiveSkill()` is neither
 *     refused at build nor reachable at run time; `present` and `skip_step`
 *     refuse that exact shape.
 *   • `.selfExplain()` is a FOURTH auto-attach family whose reservation reads
 *     the static `.tool()` registry only. A consumer provider serving
 *     `run_overview` takes it and the framework's own trace tool is
 *     unreachable; a skill tool of that name takes dispatch while the trace
 *     tool's contract stays on the wire.
 *
 * ── The ratchet, not the assertion ───────────────────────────────────────
 *
 * Several of these are genuine defects with genuine behaviour changes behind
 * them, and NONE of them is fixed here. Asserting them away would either
 * freeze them as correct or paint the suite red until somebody deletes it. So
 * this follows `docs:truth` (scripts/docs-truth-check.mjs,
 * docs/docs-truth/baseline.json):
 *
 *   • every divergence found is recorded in `toolDivergenceWalk.baseline.json`
 *     with its configuration, its mechanical cause, and — hand-written, and
 *     required — the reason it is TOLERATED;
 *   • a divergence not in the baseline FAILS: that is a new one;
 *   • a baselined divergence that stops appearing FAILS too: behaviour moved,
 *     and a ratchet that only ever loosens is a ratchet nobody is holding;
 *   • the same for a case's outcome — refused, clean, divergent — so a build
 *     that stops refusing a collision is as loud as one that starts diverging.
 *
 * Re-record with `AF_DIVERGENCE_BASELINE=update npx vitest run
 * test/core/agent/toolDivergenceWalk.test.ts`. New rows land with a `tolerated`
 * of `TODO`, and a `TODO` fails — accepting debt has to be written down by a
 * person, in a diff somebody reviews. So does anything else that gets typed
 * instead of thought: `toleratedDefect` refuses the empty string, the words
 * todo / tbd / fixme / xxx in any case, and any reason too short to hold both
 * a mechanism and a consequence. The floor is a floor on EFFORT — it cannot
 * tell a true reason from a false one, which is what review is for — but it
 * does mean a re-record cannot go green on its own.
 *
 * A `tolerated` reason says why a row is not fixed; it has no room for what
 * fixing it would COST, which is the thing a decision actually needs. The rows
 * that read "a genuine defect" — the inactive-skill shadow, the misattributed
 * report, a provider claiming `skip_step`, `.selfExplain()`'s reservation that
 * reads only the static registry, and the shadow report naming the framework's
 * own provider — are written up with their reproductions and their decision
 * surface in `docs/design/2026-09-recorded-not-built.md`, one entry each; the
 * rows say `ENTRY n` for the two that were found by this walk.
 *
 * ── 9.92.0 — what the walk records now ───────────────────────────────────
 *
 * `docs/design/2026-09-the-offer-and-the-answer.md` made dispatch FOLLOW THE
 * OFFER and re-subjected the report to the wire. On the re-record: every
 * `contract-swap` row and every `report-misattributed` row is GONE (22 rows —
 * the walk's proof that the seams closed, ratcheted so they cannot reopen
 * quietly); the `claim-swallowed` family is 33 rows, every one now carrying
 * what `agentfootprint.tools.claim_swallowed` said about it in `reported`;
 * `offer-withdrawn` (2) is untouched — a provider that withdrew a name is
 * still unroutable, by the capability law's own (d). The harness lives in
 * `toolDivergenceWalk.harness.ts` so `test/core/tools/offer-and-answer.test.ts`
 * can drive the entries' reproductions through the same configurations.
 *
 * ── What a green run does NOT prove ──────────────────────────────────────
 *
 * That the walk covers the space it walks, not that the space is complete.
 * A source nobody added to `CLAIMANTS`, a narrowing nobody added to the
 * cross-epoch cases, is invisible here exactly as it was invisible in the
 * comment. What changed is the cost of the mistake: a claimant is nine lines
 * and its collisions are then walked against every other claimant
 * automatically, so the list that has to be maintained by hand is the list of
 * SOURCES — which the type system, the builder surface and a grep can each
 * argue about — rather than the list of their INTERACTIONS, which is the part
 * that was wrong all three times.
 *
 * Test types (Convention 3): integration (every case is a real agent run) /
 * regression (the baseline ratchet) / documentation (the law's comment now
 * points here and the pin proves it still does) / property (the analyser
 * derives divergences from observation, never from a per-case expectation).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  CLAIMANTS,
  collisionCases,
  crossEpochCases,
  divergencesOf,
  frameworkCases,
  runCase,
  type CaseResult,
  type Divergence,
  type Observation,
  type Outcome,
} from './toolDivergenceWalk.harness.js';
import type { ToolsShadowedPayload } from '../../../src/events/payloads.js';
// ═════════════════════════════════════════════════════════════════════════
// The ratchet
// ═════════════════════════════════════════════════════════════════════════

const BASELINE_PATH = new URL('./toolDivergenceWalk.baseline.json', import.meta.url);

interface BaselineRow extends Omit<Divergence, 'id'> {
  /** Hand-written, and required. A placeholder fails. */
  readonly tolerated: string;
}

/**
 * The shortest `tolerated` that has ever said anything. Every reason in the
 * baseline names a mechanism and a consequence, and none of those fits in a
 * clause. The number is a floor on EFFORT, not a measure of quality — its job
 * is that "known issue" and "by design" cannot pass a review by being typed.
 */
const MIN_TOLERATED_CHARS = 40;

/**
 * Words that mean "somebody will write this later". Matched case-insensitively
 * and on word boundaries, so a reason that happens to contain "toolbox" is not
 * accused of being a TODO.
 */
const PLACEHOLDER_WORD = /\b(todos?|to-?dos?|tbd|fixme|xxx)\b/i;

/**
 * Why a `tolerated` string is not a reason — or `undefined` when it is one.
 *
 * The update path writes `TODO` for every new row on purpose: a walk that
 * re-records itself green would turn accepted debt into a side effect of
 * running a command. This is the gate that makes the re-record incomplete
 * until a person has written the sentence, and it refuses the three shapes
 * that get typed instead of thought — the placeholder word, the empty string,
 * and the clause too short to name both a mechanism and a consequence.
 */
const toleratedDefect = (tolerated: string): string | undefined => {
  const text = tolerated.trim();
  if (text.length === 0) return 'the reason is empty';
  if (PLACEHOLDER_WORD.test(text)) return `the reason is a placeholder: ${JSON.stringify(text)}`;
  if (text.length < MIN_TOLERATED_CHARS) {
    return `the reason is ${
      text.length
    } characters, under the ${MIN_TOLERATED_CHARS} a mechanism and a consequence take: ${JSON.stringify(
      text,
    )}`;
  }
  return undefined;
};

interface Baseline {
  readonly $schema: string;
  readonly note: string;
  readonly recordedAt: string;
  readonly walk: Record<string, number>;
  readonly cases: Record<string, { readonly outcome: Outcome; readonly because?: string }>;
  readonly divergences: Record<string, BaselineRow>;
}

const loadBaseline = (): Baseline => JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;

describe('the divergence walk — every offer/dispatch disagreement, discovered', () => {
  it('walks the configuration space and holds the ratchet', async () => {
    const cases = [...collisionCases(), ...crossEpochCases(), ...frameworkCases()];
    const results: CaseResult[] = [];
    for (const c of cases) results.push(await runCase(c));

    const observed = new Map<string, Divergence>();
    for (const r of results) for (const d of r.divergences) observed.set(d.id, d);

    const baseline = loadBaseline();

    if (process.env.AF_DIVERGENCE_BASELINE === 'update') {
      const next: Baseline = {
        $schema: baseline.$schema,
        note: baseline.note,
        recordedAt: new Date().toISOString().slice(0, 10),
        walk: {
          cases: results.length,
          notConstructible: results.filter((r) => r.outcome === 'not-constructible').length,
          refused: results.filter((r) => r.outcome === 'refused').length,
          clean: results.filter((r) => r.outcome === 'clean').length,
          divergent: results.filter((r) => r.outcome === 'divergent').length,
          divergences: observed.size,
        },
        cases: Object.fromEntries(
          results.map((r) => [
            r.case.id,
            { outcome: r.outcome, ...(r.because !== undefined && { because: r.because }) },
          ]),
        ),
        divergences: Object.fromEntries(
          [...observed.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, d]) => {
              const { id: _drop, ...row } = d;
              return [id, { ...row, tolerated: baseline.divergences[id]?.tolerated ?? 'TODO' }];
            }),
        ),
      };
      writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    }

    const current = loadBaseline();

    // ── 0. A probe that stopped probing fails, always, unbaselineable. ───
    // Not debt: a case whose narrowing no longer happens reports "clean"
    // about a seam it never reached.
    expect(
      results.filter((r) => r.outcome === 'vacuous').map((r) => `${r.case.id}: ${r.because}`),
      'a case stopped exercising the narrowing it exists for',
    ).toEqual([]);

    // ── 1. A NEW divergence fails. This is the whole point. ──────────────
    const novel = [...observed.keys()].filter((id) => current.divergences[id] === undefined);
    expect(
      novel.map((id) => `${id} — ${observed.get(id)!.cause}`),
      'a divergence the baseline does not know about',
    ).toEqual([]);

    // ── 2. A recorded one that disappeared fails too: behaviour moved. ───
    const vanished = Object.keys(current.divergences).filter((id) => !observed.has(id));
    expect(vanished, 'a recorded divergence stopped appearing — behaviour moved').toEqual([]);

    // ── 3. A recorded one that changed shape fails: same name, new fact. ─
    const changed: string[] = [];
    for (const [id, d] of observed) {
      const row = current.divergences[id];
      if (row === undefined) continue;
      const same =
        row.kind === d.kind &&
        row.contract === d.contract &&
        row.answered === d.answered &&
        row.reported === d.reported &&
        row.epoch === d.epoch;
      if (!same)
        changed.push(`${id}: recorded ${JSON.stringify(row)}, observed ${JSON.stringify(d)}`);
    }
    expect(changed, 'a recorded divergence changed shape').toEqual([]);

    // ── 4. Tolerated debt is written down by a person. ───────────────────
    const untold = Object.entries(current.divergences)
      .map(([id, row]) => {
        const defect = toleratedDefect(row.tolerated);
        return defect === undefined ? undefined : `${id} — ${defect}`;
      })
      .filter((s): s is string => s !== undefined);
    expect(untold, 'a recorded divergence with no reason it is tolerated').toEqual([]);

    // ── 5. Case outcomes are ratcheted too — a build that stops refusing a
    //       collision is as loud as one that starts diverging. ────────────
    const outcomeDrift: string[] = [];
    for (const r of results) {
      const row = current.cases[r.case.id];
      if (row === undefined) {
        outcomeDrift.push(`${r.case.id}: new case, outcome ${r.outcome}`);
        continue;
      }
      if (row.outcome !== r.outcome) {
        outcomeDrift.push(`${r.case.id}: recorded ${row.outcome}, observed ${r.outcome}`);
      }
    }
    const goneCases = Object.keys(current.cases).filter(
      (id) => !results.some((r) => r.case.id === id),
    );
    expect(
      [...outcomeDrift, ...goneCases.map((id) => `${id}: case no longer walked`)],
      'a case outcome moved',
    ).toEqual([]);
  }, 60_000);

  // ── What the walk COVERS is itself walked ────────────────────────────────
  //
  // The three checks below are about the enumeration, not about the agent.
  // Every one of them pins a fact that was previously true only because
  // somebody had typed it: which sources walk C crosses, how many cases that
  // comes to, and whether two reports about one tool in one epoch stay two
  // rows. A hand-written list nobody checks is the defect this file exists to
  // fix, and this file is not exempt from it.

  it('walk C crosses EVERY claimant against every auto-attach name — no source is filtered out', () => {
    const AUTO_ATTACH = ['read_skill', 'skip_step', 'run_overview', 'present'] as const;
    const cases = frameworkCases();

    // Every cell of the grid, by construction rather than by count.
    const missing: string[] = [];
    for (const c of CLAIMANTS) {
      for (const name of AUTO_ATTACH) {
        if (!cases.some((k) => k.id === `framework/${name}-vs-${c.id}`)) {
          missing.push(`framework/${name}-vs-${c.id}`);
        }
      }
    }
    expect(missing, 'a framework name is not crossed against a claimant').toEqual([]);
    expect(cases).toHaveLength(CLAIMANTS.length * AUTO_ATTACH.length);

    // The three that an earlier revision skipped. Named individually because
    // the grid check above would still pass if all four names were dropped
    // from AUTO_ATTACH — and because these three are where the interesting
    // answers turned out to be: an MCP-served catalog reaches the wire on the
    // provider channel, and the two skill shapes are what `run_overview`'s
    // reservation cannot see (docs/design/2026-09-recorded-not-built.md, 4).
    for (const id of ['mcp', 'skill-static', 'skill-inactive', 'step-skill']) {
      expect(
        cases.filter((k) => k.id.endsWith(`-vs-${id}`)),
        `walk C dropped the '${id}' claimant`,
      ).toHaveLength(AUTO_ATTACH.length);
    }
  });

  it('the case count is the arithmetic the header derives, and the baseline agrees', () => {
    const n = CLAIMANTS.length;
    expect(collisionCases()).toHaveLength(n * (n - 1));
    expect(frameworkCases()).toHaveLength(n * 4);
    const total = collisionCases().length + crossEpochCases().length + frameworkCases().length;
    expect(total).toBe(n * (n - 1) + crossEpochCases().length + n * 4);
    // The recorded count is the same number, so the header's sum cannot drift
    // from the file the ratchet reads.
    expect(loadBaseline().walk.cases).toBe(total);
  });

  it('every `walk` summary number is the count the walk produces — not only `cases`', async () => {
    // 9.86.1: the update path wrote all six numbers and only `cases` was ever
    // read back, so the block the changelog quotes ("forty … twenty-six …
    // ten") could be hand-edited to anything while the rows stayed ratcheted.
    // The per-case outcomes are pinned below; this pins their SUM.
    const recorded = loadBaseline();
    const outcomes = Object.values(recorded.cases).map((c) => c.outcome);
    const count = (o: Outcome): number => outcomes.filter((x) => x === o).length;
    expect(recorded.walk).toEqual({
      cases: outcomes.length,
      notConstructible: count('not-constructible'),
      refused: count('refused'),
      clean: count('clean'),
      divergent: count('divergent'),
      divergences: Object.keys(recorded.divergences).length,
    });
  });

  it('two differently-attributed reports for one tool in one epoch stay two rows', () => {
    const shared = { toolName: 'contested', iteration: 1 } as const;
    const obs: Observation = {
      offers: [[{ name: 'contested', description: 'contested tool [contract:skill]' }]],
      answers: new Map(),
      swallowed: [],
      shadowed: [
        {
          ...shared,
          schemaFrom: 'provider',
          schemaFromId: 'static',
          dispatchTo: 'skill',
          dispatchToId: 'desk-a',
        },
        {
          ...shared,
          schemaFrom: 'provider',
          schemaFromId: 'skill-scoped:self-explain',
          dispatchTo: 'skill',
          dispatchToId: 'desk-b',
        },
      ] as ToolsShadowedPayload[],
    };
    const found = divergencesOf(
      {
        id: 'synthetic',
        configuration: 'two reports, one tool, one epoch',
        name: 'contested',
        claims: new Map([['skill', 'skill']]),
      },
      obs,
    );

    // Both are misattributions — the wire carried the skill's contract and
    // both events say 'provider' — and they name different sources, which is
    // strictly worse than one wrong report. Keyed on tool+epoch alone the
    // second would overwrite the first in the walk's `observed` Map and
    // vanish, so the attribution is part of the row's identity.
    expect(found.map((d) => d.kind)).toEqual(['report-misattributed', 'report-misattributed']);
    expect(new Set(found.map((d) => d.id)).size).toBe(2);
    expect(found.map((d) => d.id)).toEqual([
      'synthetic::contested@e1::report-misattributed[provider(static)->skill(desk-a)]',
      'synthetic::contested@e1::report-misattributed[provider(skill-scoped:self-explain)->skill(desk-b)]',
    ]);
    // And the row's own body carries the addresses, so the two rows are told
    // apart by a reader as well as by the Map.
    expect(found[1]!.reported).toBe(
      'tools.shadowed schemaFrom=provider(skill-scoped:self-explain) dispatchTo=skill(desk-b)',
    );
  });

  it('a tolerated reason that is a placeholder, or too short to be one, is refused', () => {
    // The update path writes exactly this, and it must not pass.
    expect(toleratedDefect('TODO')).toContain('placeholder');
    // Case-insensitive, and the other three words a person types instead of
    // thinking.
    for (const word of ['todo', 'ToDo', 'TBD', 'tbd', 'FIXME', 'fixme', 'XXX', 'xxx']) {
      expect(
        toleratedDefect(`${word}: work out why this is fine before the next release`),
      ).toContain('placeholder');
    }
    // Empty and whitespace-only.
    expect(toleratedDefect('')).toBe('the reason is empty');
    expect(toleratedDefect('   \n  ')).toBe('the reason is empty');
    // Too short to name a mechanism and a consequence. 39 characters fails,
    // 40 passes — the boundary is pinned so a later edit to the constant is a
    // visible change rather than a quiet one.
    expect('by design; the provider always wins.'.length).toBeLessThan(MIN_TOLERATED_CHARS);
    expect(toleratedDefect('by design; the provider always wins.')).toContain('under the 40');
    expect(toleratedDefect('x'.repeat(MIN_TOLERATED_CHARS - 1))).toContain('under the 40');
    expect(toleratedDefect('x'.repeat(MIN_TOLERATED_CHARS))).toBeUndefined();
    // A word merely CONTAINING a placeholder is not one: the match is on word
    // boundaries, so a reason about a toolbox or an xxxhdpi asset survives.
    expect(
      toleratedDefect(
        'the toolbox provider merges first, so the schema on the wire is not the one that answers',
      ),
    ).toBeUndefined();
    // And every reason actually in the baseline passes, which is the only
    // check that matters for the file on disk.
    const failing = Object.entries(loadBaseline().divergences)
      .map(([id, row]) => (toleratedDefect(row.tolerated) === undefined ? undefined : id))
      .filter((s): s is string => s !== undefined);
    expect(failing).toEqual([]);
  });

  it('STATED: the law points at this walk instead of enumerating its own exceptions', () => {
    const src = readFileSync(
      new URL('../../../src/core/agent/buildToolRegistry.ts', import.meta.url),
      'utf8',
    );
    // The law itself stays where it binds.
    expect(src).toContain('every offered capability resolves to a dispatchable implementation');
    // What must NOT come back: a hand-maintained list claiming to be the whole
    // set. Three rounds proved that sentence cannot be kept true by hand.
    expect(src).not.toContain('the one SAME-EPOCH divergence, and the only exception');
    // And the authority is named, so a reader who wants the set reads the walk.
    expect(src).toContain('test/core/agent/toolDivergenceWalk.test.ts');
  });
});
