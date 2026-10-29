/**
 * H3 — the standing line, said when it matters:
 * `.answerLayer({ standingLine: boolean | { when } })`, where `when` is
 * `'always'` (what `true` means), `'unless-consistent'` or `'not-sure-or-ask'`.
 *
 * The mode decides ONE thing — whether the line is appended to this answer.
 * The standing travels as data in every mode, the limits block is appended
 * whether or not the line is, `ask` is said in every mode, and the answer the
 * run returns, emits and saves is one string.
 *
 * Test types (Convention 3):
 *   - UNIT      — the one decision (`compose.ts` · `standingLineSaid`): every
 *                 mode × every standing, `ask` said in all of them;
 *   - SCENARIO  — real agents on the mock provider, every mode × every standing
 *                 a delivered prose answer can have (not sure, consistent, not
 *                 assessed): the line is there exactly when the table says; the
 *                 data path (the event, `turn_end.answerAssessment`, the read-after
 *                 fold) is the same in every mode; the delivered text equals
 *                 `turn_end.finalContent`, the conversation's saved turn and
 *                 what memory stored; the answer account reads the same split;
 *   - BOUNDARY  — `true` is `'always'`, byte for byte; no separator when
 *                 nothing follows it; the limits block is independent of the
 *                 mode; both option doors refuse a mode that does not exist, an
 *                 unknown key and a bare string; the line in any mode is refused
 *                 beside `.answerValidation()` and `.outputSchema()`.
 */

import { describe, expect, it } from 'vitest';

import { Agent, coverage, defineTool, type Tool } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
} from '../../../../src/memory/index.js';
import {
  assessmentDataOf,
  standingLineSaid,
  STANDING_LINE_OPENINGS,
  type StandingLineWhen,
} from '../../../../src/core/agent/assessment/compose.js';
import type { AnswerAssessment } from '../../../../src/core/agent/assessment/types.js';

// ─── the harness ─────────────────────────────────────────────────────

type Standing = AnswerAssessment['standing'];
type LineOption = boolean | { readonly when: StandingLineWhen };

const MODES: readonly StandingLineWhen[] = ['always', 'unless-consistent', 'not-sure-or-ask'];
const STANDINGS: readonly Standing[] = ['known', 'consistent', 'not-sure', 'ask', 'not-assessed'];
const LINE = '\n\n---\n\n';
const IDENTITY = { tenant: 't', principal: 'p', conversationId: 'line-modes' };

/** What each mode says, as the spec writes it — the table the decision must equal. */
const SAID: Readonly<Record<StandingLineWhen, Readonly<Record<Standing, boolean>>>> = {
  always: { known: true, consistent: true, 'not-sure': true, ask: true, 'not-assessed': true },
  'unless-consistent': {
    known: true,
    consistent: false,
    'not-sure': true,
    ask: true,
    'not-assessed': true,
  },
  'not-sure-or-ask': {
    known: false,
    consistent: false,
    'not-sure': true,
    ask: true,
    'not-assessed': false,
  },
};

const ports = (execute: () => unknown): Tool =>
  defineTool({
    name: 'list_ports',
    description: 'Ports that are down on one switch',
    inputSchema: { type: 'object', properties: { switch: { type: 'string' } } },
    execute,
  });

/**
 * One agent per reachable standing of a delivered prose answer:
 * - `not-sure` — a lookup that came back `[]` and said nothing about what it searched;
 * - `consistent` — a lookup that returned rows (a check ran, nothing fired);
 * - `not-assessed` — no call at all (nothing on the record could be checked).
 */
const SCENES = {
  'not-sure': { calls: true, execute: () => [], answer: 'No ports on switch A are down.' },
  consistent: {
    calls: true,
    execute: () => [{ port: 'eth1/7', state: 'down' }],
    answer: 'Port eth1/7 on switch A is down.',
  },
  'not-assessed': { calls: false, execute: () => [], answer: 'Hello! Ask me about a switch.' },
} as const;
type Scene = keyof typeof SCENES;
const SCENE_NAMES = Object.keys(SCENES) as Scene[];

function agentFor(
  scene: Scene,
  line: LineOption | undefined,
  extra: { limits?: boolean; execute?: () => unknown; store?: InMemoryStore } = {},
): Agent {
  const s = SCENES[scene];
  let b = Agent.create({
    provider: mock({
      replies: [
        ...(s.calls
          ? [{ toolCalls: [{ id: 'c1', name: 'list_ports', args: { switch: 'A' } }] }]
          : []),
        { content: s.answer },
      ] as never,
    }),
    model: 'mock',
  }).tool(ports(extra.execute ?? s.execute));
  if (extra.limits === true) b = b.limitsTravelWithTheAnswer();
  if (extra.store !== undefined) {
    b = b.memory(
      defineMemory({
        id: 'turns',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: extra.store,
      }),
    );
  }
  return (line === undefined ? b.answerLayer() : b.answerLayer({ standingLine: line })).build();
}

interface Run {
  readonly text: string;
  readonly assessed: Record<string, unknown>[];
  readonly turnEnd: Record<string, unknown>;
  readonly recording: Recording;
  readonly agent: Agent;
}

async function runOnce(agent: Agent): Promise<Run> {
  const assessed: Record<string, unknown>[] = [];
  const turnEnds: Record<string, unknown>[] = [];
  agent.on('agentfootprint.answer.assessed', (e) => {
    assessed.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.agent.turn_end', (e) => {
    turnEnds.push(e.payload as unknown as Record<string, unknown>);
  });
  const recorder = recordRun(agent);
  const text = (await agent.run({
    message: 'which ports on switch A are down?',
    identity: IDENTITY,
  })) as string;
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  return { text, assessed, turnEnd: turnEnds.at(-1)!, recording, agent };
}

// ─── UNIT ────────────────────────────────────────────────────────────

describe('UNIT — the one decision: every mode × every standing', () => {
  for (const when of MODES) {
    for (const standing of STANDINGS) {
      it(`${when} × ${standing} → ${SAID[when][standing] ? 'said' : 'not said'}`, () => {
        expect(standingLineSaid(when, standing)).toBe(SAID[when][standing]);
      });
    }
  }

  it('ask is said in every mode', () => {
    expect(MODES.every((when) => standingLineSaid(when, 'ask'))).toBe(true);
  });
});

// ─── SCENARIO ────────────────────────────────────────────────────────

describe('SCENARIO — every mode × every standing a delivered prose answer can have', () => {
  const options: readonly (readonly [string, LineOption])[] = [
    ['true', true],
    ...MODES.map((when) => [`{ when: '${when}' }`, { when }] as const),
  ];
  for (const scene of SCENE_NAMES) {
    for (const [label, line] of options) {
      it(`${label} × ${scene}`, async () => {
        const store = new InMemoryStore();
        const r = await runOnce(agentFor(scene, line, { store }));
        const standing = (r.assessed[0] as { standing: Standing }).standing;
        expect(standing).toBe(scene);
        const when: StandingLineWhen =
          line === true ? 'always' : (line as { when: StandingLineWhen }).when;
        const model = SCENES[scene].answer;
        if (SAID[when][scene]) {
          expect(r.text.startsWith(`${model}${LINE}${STANDING_LINE_OPENINGS[scene]}`)).toBe(true);
        } else {
          // No line, nothing else to append: the model's words, byte for byte — no separator.
          expect(r.text).toBe(model);
        }
        // THE DATA PATH — the same in every mode: the event, turn_end, the read-after fold.
        const { turn: _t, iteration: _i, ...data } = r.assessed[0]!;
        void _t;
        void _i;
        expect(r.turnEnd.answerAssessment).toEqual(data);
        expect(assessmentDataOf(assessAnswer(r.recording))).toEqual(data);
        // DELIVERED = SAVED: the run's answer, turn_end, the conversation and memory hold one string.
        expect(r.turnEnd.finalContent).toBe(r.text);
        expect(r.agent.checkpoint()?.history.at(-1)?.content).toBe(r.text);
        const saved = JSON.stringify((await store.list(IDENTITY)).entries);
        expect(saved).toContain(JSON.stringify(r.text));
        if (!SAID[when][scene]) expect(saved).not.toContain(STANDING_LINE_OPENINGS[scene]);
        // The answer account splits the same way: the model's own words, and what was appended.
        const account = accountForAnswer(r.recording);
        expect(account.answer.value).toBe(model);
        if (SAID[when][scene])
          expect(r.text).toBe(`${model}${LINE}${account.facts.limitsBlock.value}`);
        else expect(account.facts.limitsBlock.value).toBeNull();
      });
    }
  }

  it('the data is the same whether or not the line is said', async () => {
    for (const scene of SCENE_NAMES) {
      const payloads = await Promise.all(
        [true, ...MODES.map((when) => ({ when }))].map(async (line) => {
          const r = await runOnce(agentFor(scene, line));
          return [r.assessed, r.turnEnd.answerAssessment];
        }),
      );
      for (const p of payloads) expect(p).toEqual(payloads[0]);
      // …and equal to an agent whose layer appends no line at all.
      const dataOnly = await runOnce(agentFor(scene, undefined));
      expect([dataOnly.assessed, dataOnly.turnEnd.answerAssessment]).toEqual(payloads[0]);
    }
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────

describe('BOUNDARY — `true` is "always", byte for byte', () => {
  for (const scene of SCENE_NAMES) {
    it(`${scene}: true and { when: 'always' } deliver the same bytes`, async () => {
      const a = await runOnce(agentFor(scene, true));
      const b = await runOnce(agentFor(scene, { when: 'always' }));
      expect(b.text).toBe(a.text);
      expect(b.turnEnd.finalContent).toBe(a.turnEnd.finalContent);
    });
  }
});

describe('BOUNDARY — the limits block is independent of the mode', () => {
  const declaring = () => coverage([{ port: 'eth1/7', state: 'down' }], { checked: ['switch A'] });

  it('a consistent answer under not-sure-or-ask: the block, after the separator, and no line', async () => {
    const quiet = await runOnce(
      agentFor('consistent', { when: 'not-sure-or-ask' }, { limits: true, execute: declaring }),
    );
    const noLayerLine = await runOnce(
      agentFor('consistent', false, { limits: true, execute: declaring }),
    );
    expect(quiet.text).toBe(noLayerLine.text);
    expect(quiet.text).toContain(`${LINE}Coverage of this answer`);
    expect(quiet.text).not.toContain(STANDING_LINE_OPENINGS.consistent);
  });

  it('the same answer under always: the line opens the section and the block follows it', async () => {
    const said = await runOnce(agentFor('consistent', true, { limits: true, execute: declaring }));
    const quiet = await runOnce(
      agentFor('consistent', { when: 'not-sure-or-ask' }, { limits: true, execute: declaring }),
    );
    const [model, section] = said.text.split(LINE);
    expect(section!.startsWith(STANDING_LINE_OPENINGS.consistent)).toBe(true);
    // Take the line off and the rest is the quiet answer, byte for byte.
    const line = section!.split('\n\n')[0]!;
    expect(`${model}${LINE}${section!.slice(line.length + 2)}`).toBe(quiet.text);
  });
});

describe('BOUNDARY — both option doors refuse what is not a mode', () => {
  const build = (line: unknown, door: 'builder' | 'options') => () => {
    const base = {
      provider: mock({ replies: [{ content: 'x' }] }),
      model: 'mock',
    };
    return door === 'builder'
      ? Agent.create(base)
          .answerLayer({ standingLine: line } as never)
          .build()
      : Agent.create({ ...base, answerLayer: { standingLine: line } } as never).build();
  };
  for (const door of ['builder', 'options'] as const) {
    it(`${door}: a mode that does not exist, a missing one, an unknown key, a bare string`, () => {
      expect(build({ when: 'sometimes' }, door)).toThrow(/standingLine\.when must be one of/);
      expect(build({}, door)).toThrow(/standingLine\.when must be one of/);
      expect(build({ when: 'always', loud: true }, door)).toThrow(/unknown option\(s\) 'loud'/);
      expect(build('always', door)).toThrow(/standingLine must be a boolean or \{ when \}/);
      expect(build(['always'], door)).toThrow(/standingLine must be a boolean or \{ when \}/);
      for (const when of MODES) expect(build({ when }, door)).not.toThrow();
    });
  }

  it('the line, in any mode, is refused beside .answerValidation() and .outputSchema()', () => {
    const parser = { parse: (v: unknown) => v, toJsonSchema: () => ({ type: 'object' }) };
    const validation = {
      id: 'v',
      version: '1',
      validate() {
        return { checks: [{ id: 'v', disposition: 'checked-pass' as const }] };
      },
    };
    for (const when of MODES) {
      expect(() =>
        Agent.create({ provider: mock({ replies: [] }), model: 'mock' })
          .outputSchema(parser as never)
          .answerValidation(validation)
          .answerLayer({ standingLine: { when } })
          .build(),
      ).toThrow(/cannot be combined with \.answerValidation\(\)/);
      expect(() =>
        Agent.create({ provider: mock({ replies: [] }), model: 'mock' })
          .outputSchema(parser as never)
          .answerLayer({ standingLine: { when } })
          .build(),
      ).toThrow(/cannot be combined with \.outputSchema\(\)/);
    }
  });
});
