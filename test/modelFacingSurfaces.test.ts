/**
 * THE INVENTORY — every model-facing producer `test/helpers/modelFacingClaims.ts`
 * is responsible for, and proof that each one is actually read by the checker.
 *
 * ── WHY A REGISTRY AND NOT MORE ASSERTIONS ────────────────────────────────
 *
 * Round 3 of the skill-graph cursor bug shipped WITH the checker already
 * written. The banned sentence did not defeat it; the sentence moved forty
 * lines, into the `read_skill` description, and the suite that owned the
 * checker did not read that surface. Nothing went red, because coverage was
 * decided by which suite happened to import the helper — a habit, not a
 * guarantee.
 *
 * So the producers are listed HERE. Each row composes the producer's REAL
 * output by calling the shipped code (never a copy of the sentence), and every
 * row is read by `unprovable()` at its own surface. A registered producer
 * cannot be an unchecked one: the row IS the check, whatever any other suite
 * does or stops doing.
 *
 * ── WHAT A GREEN RUN HERE DOES NOT PROVE ──────────────────────────────────
 *
 * The list is hand-maintained, so it proves exactly one thing: REGISTERED
 * producers are checked. It cannot see a producer nobody registered. A new
 * model-facing sentence written into a new file tomorrow is invisible here
 * until somebody adds the row — which is precisely the shape of the round-3
 * escape, one level up. No hand-maintained list can close that gap; only a
 * scan of `src/` for the banned clauses could, and this is not that. Read a
 * green run as "the surfaces we know about are clean", never as "every
 * model-facing sentence in the library is clean".
 *
 * `drivenBy` names the suites that exercise a producer END TO END through a
 * real agent. It is documentation for the reader and is checked only for
 * existence: the checker coverage comes from the row itself, so a producer
 * whose end-to-end suite is renamed loses a pointer, not its checking.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Agent,
  codeRunnerTool,
  inMemoryArtifacts,
  type ArtifactScope,
  type CodeRunner,
} from '../src/index.js';
import { mock } from '../src/llm-providers.js';
import { defineSkill } from '../src/injection-engine.js';
import { selfCallNotice } from '../src/core/agent/selfCallNotice.js';
import {
  readSkillDescriptor,
  type ReadSkillOffer,
} from '../src/lib/injection-engine/skillToolDescriptors.js';
import { presentArtifact } from '../src/artifacts/present.js';
import { resolveToolWants } from '../src/artifacts/wants.js';
import {
  unprovable,
  TOOL_RESULT,
  GRAPH_TOOL_DESCRIPTION,
  type Surface,
} from './helpers/modelFacingClaims.js';

/** One model-facing producer, and how to make it speak. */
interface ModelFacingProducer {
  /** What a reader greps for when this row goes red. */
  readonly id: string;
  /** The file that composes the sentences — the one to open. */
  readonly module: string;
  readonly surface: Surface;
  /** The evidence for `surface.lifetime`. An asserted lifetime is an exemption
   *  with no argument, which is how a false sentence gets waved through. */
  readonly lifetimeBecause: string;
  /** Suites that drive this producer end to end. Checked for existence only. */
  readonly drivenBy: readonly string[];
  /** The producer's real output — every arm that can reach the model. */
  readonly compose: () => Promise<readonly string[]>;
  /**
   * Markers proving `compose` still REACHES the arms that carried a false
   * sentence — one stable phrase per arm, never the wording of a fix.
   *
   * Without them a row can rot into vacuous coverage: `compose` drifts to the
   * easy arms, the checker reads only those, and the row goes on reporting
   * that its producer is covered. That is the round-3 failure wearing a green
   * badge, so it fails here instead.
   */
  readonly reaches: readonly RegExp[];
}

// ─── Fixtures the rows compose against ───────────────────────────────

const SCOPE: ArtifactScope = { conversationId: 'model-facing-inventory' };

const skills = [
  defineSkill({ id: 'alpha', description: 'alpha does things', body: 'ALPHA_BODY' }),
  defineSkill({ id: 'beta', description: 'beta does things', body: 'BETA_BODY' }),
  defineSkill({ id: 'gamma', description: 'gamma does things', body: 'GAMMA_BODY' }),
];

/** Every `read_skill` description shape a graph run can compose. */
const readSkillDescriptions = (): readonly string[] => {
  const offers: readonly ReadSkillOffer[] = [
    // Decisively routed: a cursor, no menu, something reachable and something not.
    { grantable: ['beta'], showRefusable: true, cursorId: 'alpha' },
    // The cursor with nowhere to go — the arm that says so in one sentence.
    { grantable: [], showRefusable: true, cursorId: 'alpha' },
    // Turn-start menu, stay offered.
    {
      grantable: ['beta', 'gamma'],
      cursorId: 'alpha',
      menu: { candidates: [{ id: 'beta', relevance: 0.71 }], cursorId: 'alpha', stay: true },
    },
    // Role-hidden cursor: the description may name nothing about it.
    { grantable: ['gamma'], showRefusable: true, cursorId: 'alpha', hiddenIds: ['alpha', 'beta'] },
    // No graph — the plain catalog this tool has always had.
    {},
  ];
  return [
    ...offers.map((offer) => readSkillDescriptor(skills, offer)?.description ?? ''),
    readSkillDescriptor(skills)?.description ?? '',
  ];
};

/** Every `present` refusal, over an empty scope and a stocked one. */
const presentRefusals = async (): Promise<readonly string[]> => {
  const store = inMemoryArtifacts();
  const refusal = async (args: Record<string, unknown>): Promise<string> => {
    const outcome = await presentArtifact(store, SCOPE, args);
    if (outcome.ok) throw new Error(`present(${JSON.stringify(args)}) was expected to refuse`);
    return outcome.refusal;
  };
  const out = [
    await refusal({ as: 'table' }),
    await refusal({ ref: 'art_missing' }),
    // The listing arm that reported the moment instead of the call.
    await refusal({ ref: 'art_missing', as: 'table' }),
  ];
  await store.put(SCOPE, {
    kind: 'chart/spec',
    mediaType: 'application/json',
    data: { bars: [1, 2, 3] },
    label: 'Q3 sales',
  });
  // The same refusal once the scope HAS something — the state that falsifies
  // the sentence above when it is re-read.
  return [...out, await refusal({ ref: 'art_missing', as: 'table' })];
};

/** Every `wants` dispatch refusal, over an empty scope and a stocked one. */
const wantsRefusals = async (): Promise<readonly string[]> => {
  const store = inMemoryArtifacts();
  const wants = { dataset: 'dataset/rows' } as const;
  const schema = {
    type: 'object',
    properties: { dataset: { type: 'string' } },
    required: ['dataset'],
  };
  const refusal = async (args: Record<string, unknown>): Promise<string> => {
    const verdict = await resolveToolWants(store, SCOPE, 'summarize_rows', wants, args, schema);
    if (verdict.ok) throw new Error(`wants(${JSON.stringify(args)}) was expected to refuse`);
    return verdict.refusal;
  };
  const out = [
    await refusal({}),
    await refusal({ dataset: 42 }),
    await refusal({ dataset: 'art_missing' }),
  ];
  const { meta: wrongKind } = await store.put(SCOPE, {
    kind: 'file/csv',
    mediaType: 'text/csv',
    data: 'region,total\nwest,42\n',
    label: 'rows.csv',
  });
  await store.put(SCOPE, {
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data: [{ region: 'west' }],
    label: 'Q3 rows',
  });
  // Stocked scope: the kind-mismatch arm, and the listing that CAN resolve.
  return [...out, await refusal({ dataset: wrongKind.ref }), await refusal({})];
};

/** The code runner's rendered result, on a call that passed no artifact ref. */
const codeRunnerResults = async (): Promise<readonly string[]> => {
  const runner: CodeRunner = {
    id: 'inventory-runner',
    start: async () => ({
      id: 'session-1',
      stageInputs: async (inputs) =>
        inputs.map((input) => ({ name: input.name, path: `/session/${input.name}`, bytes: 1 })),
      execute: async () => ({ ok: true, stdout: 'ran', stderr: '', artifacts: [] }),
      stop: async () => undefined,
    }),
  };
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [{ id: 't1', name: 'run_code', args: { code: 'print(1)' } }],
          stopReason: 'tool_use',
        },
        { content: 'done', toolCalls: [], stopReason: 'stop' },
      ] as never,
    }),
    model: 'mock',
    maxIterations: 3,
    artifacts: { store: inMemoryArtifacts() },
  })
    .system('s')
    .tool(codeRunnerTool({ runner, wants: { dataset: 'dataset/rows' } }))
    .build();
  const results: string[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) =>
    results.push(String((e.payload as { result?: unknown }).result)),
  );
  await agent.run({ message: 'go' });
  return results;
};

// ─── The registry ────────────────────────────────────────────────────

const PRODUCERS: readonly ModelFacingProducer[] = [
  {
    id: 'skill-graph — the read_skill SELF-CALL notice',
    module: 'src/core/agent/selfCallNotice.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the gate overwrites the tool result with it, so it is written into `history` and ' +
      're-read on every later call of the turn, wrap-up included',
    drivenBy: ['test/skillGraphSelfCall.test.ts'],
    reaches: [/named the skill you were already standing in/, /tool list/, /ALPHA_BODY/],
    compose: async () => [
      selfCallNotice({
        skillId: 'alpha',
        tools: { declared: ['alpha_tool'], served: ['alpha_tool'] },
      }),
      selfCallNotice({ skillId: 'alpha', tools: { declared: ['alpha_tool'], served: [] } }),
      selfCallNotice({ skillId: 'alpha', tools: { declared: [], served: [] } }),
      selfCallNotice({ skillId: 'alpha', tools: undefined }),
      selfCallNotice({
        skillId: 'alpha',
        tools: { declared: ['alpha_tool'], served: ['alpha_tool'] },
        body: 'ALPHA_BODY',
      }),
    ],
  },
  {
    id: 'skill-graph — the read_skill DESCRIPTION (the offer)',
    module: 'src/lib/injection-engine/skillToolDescriptors.ts',
    surface: GRAPH_TOOL_DESCRIPTION,
    lifetimeBecause:
      "`AgentBuilder.skillGraph` throws under `reactMode: 'classic'`, the one mode that " +
      'caches the tools slot, so a description carrying an offer was composed for the ' +
      'request being answered and is never re-read',
    drivenBy: ['test/skillGraphSelfCall.test.ts', 'test/security/skill-visibility.test.ts'],
    reaches: [
      /Activate a skill for the next iteration/,
      /Reachable from here/,
      /Not reachable from here/,
    ],
    compose: async () => readSkillDescriptions(),
  },
  {
    id: 'artifacts — the `present` teaching refusal',
    module: 'src/artifacts/present.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'the tool-calls stage overwrites the placeholder result with it (`applyPresent`), so ' +
      'it lands on a `role: "tool"` message like any other result',
    drivenBy: ['test/artifacts/present.test.ts'],
    // One marker PER ARM, and the empty-scope arm needs its own. The two
    // obvious markers do not pin it: `found nothing under that ref` matches
    // both arms of the `listing` ternary, and `Live refs in scope` matches
    // only the stocked one — so the arm carrying the sentence this release
    // fixed had no marker at all, and dropping it from `compose` left the
    // suite green. That is the round-3 escape reproduced inside the guard
    // built to prevent it: a checker is only as wide as what it is handed.
    reaches: [/found nothing under that ref/, /Nothing was live/, /Live refs in scope/],
    compose: presentRefusals,
  },
  {
    id: 'artifacts — the `wants` dispatch refusal',
    module: 'src/artifacts/wants.ts',
    surface: TOOL_RESULT,
    lifetimeBecause:
      'dispatch returns it as the tool result of a call it declined to run, so the model ' +
      're-reads it for the rest of the turn',
    drivenBy: ['test/artifacts/wants-dispatch.test.ts', 'test/core/code-staging.test.ts'],
    reaches: [
      /was not executed/,
      /No live 'dataset\/rows' artifacts/,
      /Live 'dataset\/rows' refs in scope/,
    ],
    compose: wantsRefusals,
  },
  {
    id: 'code runner — the rendered run result',
    module: 'src/core/codeRunnerTool.ts',
    surface: TOOL_RESULT,
    lifetimeBecause: "it is the return value of the tool's `execute` — a tool result outright",
    drivenBy: ['test/core/code-staging.test.ts', 'test/artifacts/code-artifacts.test.ts'],
    reaches: [/no artifact inputs were passed/],
    compose: codeRunnerResults,
  },
];

// ─── The checks ──────────────────────────────────────────────────────

describe('the model-facing inventory', () => {
  it('every registered producer composes real output, and the checker reads all of it', async () => {
    for (const producer of PRODUCERS) {
      const texts = await producer.compose();
      // A row that composes nothing exercises nothing — and would pass every
      // assertion below by having no text to fail on.
      expect(texts.length, `${producer.id} composed no output`).toBeGreaterThan(0);
      for (const text of texts) {
        expect(text.length, `${producer.id} composed an empty string`).toBeGreaterThan(0);
        expect(unprovable(text, producer.surface), `${producer.id} — ${text}`).toEqual([]);
      }
      const all = texts.join('\n');
      for (const marker of producer.reaches) {
        expect(marker.test(all), `${producer.id} no longer reaches ${marker.source}`).toBe(true);
      }
    }
  });

  it('the alarm is wired — a known-false sentence is still caught at every persistent surface', () => {
    // Without this, a checker that silently stopped reporting would turn every
    // row above green. The sentence is the one that shipped three times.
    for (const producer of PRODUCERS) {
      if (producer.surface.lifetime !== 'persistent-history') continue;
      expect(
        unprovable('nothing is live in this scope right now', producer.surface),
        producer.id,
      ).not.toEqual([]);
    }
  });

  it('every producer and every end-to-end suite it names is still on disk', () => {
    for (const producer of PRODUCERS) {
      expect(existsSync(resolve(process.cwd(), producer.module)), producer.module).toBe(true);
      for (const suite of producer.drivenBy) {
        expect(existsSync(resolve(process.cwd(), suite)), `${producer.id} → ${suite}`).toBe(true);
      }
    }
  });
});
