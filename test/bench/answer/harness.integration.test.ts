/**
 * The answer bench END TO END on the library's sources — the bench's own harness
 * (`bench/answer/harness.mjs` · `runCase`) driving a real Agent with and without `.answerLayer()`,
 * recorded by `recordRun`, folded by `assessAnswer`, read by `bench/answer/metrics.mjs` ·
 * `readRun`. $0: the scripted mock, and a stubbed Anthropic SDK client behind the package's own
 * Anthropic adapter.
 *
 * Test types:
 *   - INTEGRATION — every scripted variant of every case under `off`, `layer` and `line`: the
 *                   layer's in-run standing equals the read-after fold and `agent.assessment()`,
 *                   one event per answer; `off` fires none; the model is served the same bytes
 *                   under `off` and `layer` (every request of every run) and returns the same
 *                   answer; the prose arm appends one line after the model's text and changes
 *                   nothing it was served in the same turn; the planted provocations land where
 *                   the fold reads them (empty-undeclared, declared-absent, coverage-gap);
 *   - FUNCTIONAL  — the anthropic path: wire bodies digested, the first body identical across
 *                   arms, usage priced at Haiku 4.5 rates; the command line refuses a paid run
 *                   without a cap, any model but Haiku 4.5, and a judge without both arms; the
 *                   plan interleaves the arms and is seeded.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, caseById } from '../../../bench/answer/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { runCase } from '../../../bench/answer/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { readRun } from '../../../bench/answer/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { DEFAULTS, parseArgs, planOf } from '../../../bench/answer/run.mjs';
import { doors } from './doors.js';

const MINUTE = 60_000;

async function mockRun(caseDef: any, arm: string, rep: number) {
  const raw = await runCase({ doors, caseDef, arm, rep, provider: 'mock', model: 'mock' });
  expect(raw.mockExhausted, `${arm}/${caseDef.id}/r${rep}`).toBeUndefined();
  return { raw, row: readRun(raw) };
}

describe('INTEGRATION — every scripted variant, under every arm', () => {
  it(
    'the layer folds in the run what a reader folds after; off fires nothing; the bytes do not move',
    async () => {
      for (const c of CASES) {
        for (let rep = 0; rep < c.mock.length; rep += 1) {
          const off = await mockRun(c, 'off', rep);
          const layer = await mockRun(c, 'layer', rep);
          const line = await mockRun(c, 'line', rep);
          const tag = `${c.id} · ${c.mock[rep].label}`;

          // in-run == read-after, one event per answered turn; off fires none
          expect(layer.row.outcome, tag).toBe('answered');
          expect(layer.row.equality, tag).toMatchObject({
            eventIsTurnEnd: true,
            eventIsReadAfter: true,
            eventIsAgentAssessment: true,
          });
          expect(
            layer.row.equality.events.every((n: number) => n === 1),
            tag,
          ).toBe(true);
          expect(
            off.row.equality.events.every((n: number) => n === 0),
            tag,
          ).toBe(true);
          // the read-after fold of the unarmed run is the layer's in-run standing
          expect(off.row.standing, tag).toBe(layer.row.standing);
          expect(off.row.reasons, tag).toEqual(layer.row.reasons);

          // model-facing bytes: every request of the run, not only the first
          expect(layer.row.requestsDigest, tag).toBe(off.row.requestsDigest);
          // answer bytes: the model's text, the same under both arms
          expect(layer.row.answerIsModelText, tag).toBe(true);
          expect(off.row.answerIsModelText, tag).toBe(true);
          expect(
            layer.raw.turns.map((t: any) => t.answer),
            tag,
          ).toEqual(off.raw.turns.map((t: any) => t.answer));

          // the prose arm: one line appended after the model's text, same standing
          expect(line.row.lineAppended, tag).toBe(true);
          expect(line.row.standing, tag).toBe(layer.row.standing);
          const lastLine = line.raw.turns.at(-1);
          expect(lastLine.answer.startsWith(lastLine.modelText), tag).toBe(true);
          // …and within its first turn it serves the model nothing new
          const firstTurn = (r: any) =>
            r.raw.requests.filter((q: any) => q.turn === 0).map((q: any) => q.digest);
          expect(firstTurn(line), tag).toEqual(firstTurn(off));
        }
      }
    },
    5 * MINUTE,
  );

  it(
    'the planted provocations land where the fold reads them',
    async () => {
      const first = async (id: string, label: string) => {
        const c = caseById(id);
        return (
          await mockRun(
            c,
            'layer',
            c.mock.findIndex((v: any) => v.label === label),
          )
        ).row;
      };
      expect(
        await first('absent-undeclared', 'looks up; says flatly there are none'),
      ).toMatchObject({
        standing: 'not-sure',
        reasons: ['empty-undeclared'],
        exceeds: true,
      });
      expect(await first('absent-undeclared', 'answers without a lookup')).toMatchObject({
        standing: 'not-assessed',
        flags: false,
      });
      expect(
        (await first('absent-declared', 'looks up; says flatly nothing was deployed')).reasons,
      ).toEqual(['coverage-gap', 'declared-absent']);
      expect(
        (await first('overclaim-week-errors', 'answers for the week from one day')).reasons,
      ).toEqual(['coverage-gap']);
      const invented = await first('found-incidents', 'looks up; invents a ticket number');
      expect(invented).toMatchObject({ standing: 'not-sure', uncarried: ['9921'] });
      expect(invented.reasons).toContain('value-unsupported');
      const found = await first('found-hosts', 'looks up; restates all three');
      expect(found).toMatchObject({
        standing: 'consistent',
        supports: true,
        facts: { expected: 3, found: 3 },
      });
      expect(found.grounded).toBe(1);
      // the measured turn of a continued conversation reads its own lookup, not turn 1's empty one
      expect(await first('found-followup', 'looks up both turns')).toMatchObject({
        standing: 'consistent',
        reasons: [],
      });
    },
    MINUTE,
  );
});

describe('FUNCTIONAL — the anthropic path through the package’s own adapter, $0', () => {
  /** A stub of the SDK client: call list_hosts, then answer; usage reported as the API does. */
  function stubClient(bodies: any[]) {
    let n = 0;
    const reply = (params: any) => {
      bodies.push(params);
      n += 1;
      const usage = { input_tokens: 1000, output_tokens: 100 };
      if (n === 1) {
        return {
          id: 'm1',
          model: params.model,
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'list_hosts', input: {} }],
          stop_reason: 'tool_use',
          usage,
        };
      }
      return {
        id: 'm2',
        model: params.model,
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Three hosts: srv-4417 (database), srv-2280 (web), srv-9051 (cache).',
          },
        ],
        stop_reason: 'end_turn',
        usage,
      };
    };
    return {
      messages: {
        create: async (params: any) => reply(params),
        stream: (params: any) => {
          const message = reply(params);
          return {
            async *[Symbol.asyncIterator]() {
              for (const block of message.content) {
                if (block.type === 'text')
                  yield {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: block.text },
                  };
              }
            },
            finalMessage: async () => message,
          };
        },
      },
    };
  }

  it(
    'digests the wire, serves the same first body under both arms, and prices the usage',
    async () => {
      const rows: any[] = [];
      for (const arm of ['off', 'layer']) {
        const bodies: any[] = [];
        const raw = await runCase({
          doors,
          caseDef: caseById('found-hosts'),
          arm,
          rep: 0,
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          sdkClient: stubClient(bodies),
        });
        expect(bodies).toHaveLength(2);
        expect(bodies[0].tools.map((t: any) => t.name)).toEqual([
          'list_incidents',
          'find_deploys',
          'list_alerts',
          'error_log',
          'list_hosts',
          'host_metrics',
        ]);
        expect(bodies[0].temperature).toBeUndefined();
        expect(raw.usd).toBeCloseTo(0.003, 10);
        rows.push(readRun(raw));
      }
      const [off, layer] = rows;
      expect(layer.firstRequestDigest).toBe(off.firstRequestDigest);
      expect(layer.requestsDigest).toBe(off.requestsDigest);
      expect(layer).toMatchObject({ standing: 'consistent', answerIsModelText: true });
      expect(layer.equality).toMatchObject({
        eventIsReadAfter: true,
        eventIsAgentAssessment: true,
      });
    },
    MINUTE,
  );
});

describe('FUNCTIONAL — the command line', () => {
  it('refuses before anything is built or spent', () => {
    expect(() => parseArgs(['--provider', 'anthropic'])).toThrow(/needs --max-usd/);
    expect(() =>
      parseArgs(['--provider', 'anthropic', '--max-usd', '1', '--model', 'claude-sonnet-5']),
    ).toThrow(/Haiku 4.5 only/);
    expect(() => parseArgs(['--arms', 'off', '--judge', 'step6'])).toThrow(/off and layer/);
    expect(() => parseArgs(['--arms', 'off,bogus'])).toThrow(/unknown arm/);
    expect(() => parseArgs(['--concurrency', '5'])).toThrow(/at most 4/);
  });

  it('defaults: Haiku 4.5, 10 runs, off and layer, the registered seed', () => {
    const o = parseArgs(['--provider', 'anthropic', '--max-usd', '1.40']);
    expect(o).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      runs: 10,
      arms: ['off', 'layer'],
      seed: 20260928,
    });
    expect(DEFAULTS.seed).toBe(20260928);
  });

  it('plans every (case, arm) pair per repetition, interleaved and seeded', () => {
    const opts = {
      cases: CASES,
      arms: ['off', 'layer'],
      runs: 2,
      seed: 20260928,
      provider: 'anthropic',
    };
    const plan = planOf(opts);
    expect(plan).toHaveLength(CASES.length * 2 * 2);
    expect(planOf(opts)).toEqual(plan);
    const round0 = plan.slice(0, CASES.length * 2);
    expect(new Set(round0.map((p: any) => `${p.arm}/${p.caseId}`)).size).toBe(CASES.length * 2);
    expect(round0.every((p: any) => p.rep === 0)).toBe(true);
    // interleaved: the first round is not all of one arm first
    expect(round0.slice(0, CASES.length).every((p: any) => p.arm === 'off')).toBe(false);
  });
});
