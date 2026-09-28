/**
 * The results bench's paid path, at $0: the package's own Anthropic adapter over a stubbed SDK
 * client, both arms.
 *
 * Test types:
 *   - INTEGRATION — the wire bodies carry the model id, the three tools, no temperature and the
 *                   1,024-token bound; the usage is priced at Haiku 4.5 rates; the on arm's tool
 *                   result reaches the model with its period and the standing names the planted
 *                   reason; the off arm's does not;
 *   - FUNCTIONAL  — the cap: `runPlan` stops before a run whose projected cost would cross it, and
 *                   says so on the record.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { caseById } from '../../../bench/results/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { runCase } from '../../../bench/results/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { readRun } from '../../../bench/results/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { planOf, runPlan } from '../../../bench/results/run.mjs';
import { doors } from './doors.js';

/** A stub of the SDK client: call `tool` with `input`, then answer `text`. Usage as the API reports it. */
function stubClient(bodies: any[], tool: string, input: object, text: string) {
  let n = 0;
  const reply = (params: any) => {
    bodies.push(params);
    n += 1;
    const usage = { input_tokens: 1000, output_tokens: 100 };
    const content =
      n === 1
        ? [{ type: 'tool_use', id: `toolu_${n}`, name: tool, input }]
        : [{ type: 'text', text }];
    return {
      id: `m${n}`,
      model: params.model,
      role: 'assistant',
      content,
      stop_reason: n === 1 ? 'tool_use' : 'end_turn',
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
            for (const block of message.content)
              if (block.type === 'text')
                yield {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: block.text },
                };
          },
          finalMessage: async () => message,
        };
      },
    },
  };
}

const HAIKU = 'claude-haiku-4-5-20251001';

describe('INTEGRATION — the anthropic path through the package’s own adapter, $0', () => {
  it.each(['off', 'on'])(
    'arm %s: wire, price, and what the model read',
    async (arm) => {
      const bodies: any[] = [];
      const raw = await runCase({
        doors,
        caseDef: caseById('r1-backups-last-hour'),
        arm,
        rep: 0,
        provider: 'anthropic',
        model: HAIKU,
        sdkClient: stubClient(
          bodies,
          'backup_failures',
          { window: '1h' },
          'No failed backups in the last hour.',
        ),
      });
      expect(raw.answer).toBe('No failed backups in the last hour.');
      expect(bodies).toHaveLength(2);
      expect(bodies[0].model).toBe(HAIKU);
      expect(bodies[0].tools.map((t: any) => t.name)).toEqual([
        'backup_failures',
        'search_errors',
        'job_failures',
      ]);
      expect(bodies[0].temperature).toBeUndefined();
      expect(bodies[0].max_tokens).toBe(1024);
      expect(raw.usage).toMatchObject({ calls: 2, input: 2000, output: 200 });
      expect(raw.usd).toBeCloseTo(0.003, 10);
      const served = JSON.stringify(bodies[1].messages);
      const row = readRun(raw);
      expect(row.label.flat).toBe(true);
      if (arm === 'on') {
        expect(served).toContain(
          '\\"held\\":{\\"from\\":\\"2026-08-27T02:00:00Z\\",\\"to\\":\\"2026-09-26T02:00:00Z\\"}',
        );
        expect(row.periodReasons).toEqual(['period-not-held']);
        expect(row.foldAgrees).toBe(true);
      } else {
        expect(served).not.toContain('\\"period\\"');
        expect(served).toContain('taken at 2026-09-26 02:00 UTC');
        expect(row.periodReasons).toEqual([]);
      }
    },
    60_000,
  );
});

describe('FUNCTIONAL — the cap', () => {
  it('stops before a run whose projected cost would cross it, on the record', async () => {
    const plan = planOf({
      cases: [caseById('r1-backups-last-hour')],
      runs: 5,
      seed: 1,
      provider: 'anthropic',
    });
    const { raws, spend } = await runPlan({
      plan,
      doors,
      opts: { provider: 'anthropic', model: HAIKU, maxUsd: 0.05, concurrency: 1 },
      sdkClient: {
        messages: {
          create: async (params: any) =>
            stubClient([], 'backup_failures', { window: '1h' }, 'x').messages.create(params),
          stream: (params: any) =>
            stubClient([], 'backup_failures', { window: '1h' }, 'x').messages.stream(params),
        },
      },
      dir: undefined,
    });
    // Every call meets a fresh stub that calls the tool, so each run loops to maxIterations (6 calls, $0.009).
    expect(spend.stopped).toMatch(/^after \d+ of 10 runs/);
    expect(spend.usd).toBeLessThanOrEqual(0.05);
    expect(raws.length).toBeLessThan(10);
  }, 60_000);
});
