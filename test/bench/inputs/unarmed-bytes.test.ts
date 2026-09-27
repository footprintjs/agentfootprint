/**
 * BYTE IDENTITY, UNARMED — the inputs bench's baseline is the agent as it ships, and it stays so.
 *
 * Step 2 ships no library code, so the 21 byte references under `test/core/tools/reference/` do
 * not move (`test/core/tools/byte-identity.test.ts` pins them; this step touches neither). This
 * file pins the bench's OWN baseline for the steps that follow: steps 3 and 4 must leave an
 * unarmed agent serving exactly these bytes.
 *
 * Test types:
 *   - BYTE IDENTITY — a fresh mock baseline on the sources (every scripted variant of every
 *                     case, arm `off`) equals `bench/inputs/results/mock.json` byte for byte: every
 *                     row, every aggregate, and every served request's digest (`requestsDigest`,
 *                     `harness.mjs` · `projectRequest`). `node bench/inputs/run.mjs --pin-mock`
 *                     regenerates it from the BUILT package — so a green run here also says the
 *                     sources and the build serve the same bytes;
 *   - UNIT          — the served tools ARE the sheet's schemas, byte for byte: nothing decorated,
 *                     `required` untouched, no reserved argument; and the run commits no key an
 *                     armed inputs layer would write.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, SYSTEM_PROMPT, TOOLS, caseById } from '../../../bench/inputs/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { runCase, stableJson } from '../../../bench/inputs/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { readRun } from '../../../bench/inputs/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { MOCK_PIN, mockPin, planOf } from '../../../bench/inputs/run.mjs';
import { doors } from './doors.js';

describe('BYTE IDENTITY — the pinned mock baseline', () => {
  it(
    'a fresh run on the sources reproduces bench/inputs/results/mock.json byte for byte',
    async () => {
      const plan = planOf({
        cases: CASES,
        arms: ['off'],
        runs: undefined,
        seed: 20260927,
        provider: 'mock',
      });
      const rows = [];
      for (const item of plan) {
        const raw = await runCase({
          doors,
          caseDef: caseById(item.caseId),
          arm: item.arm,
          rep: item.rep,
          provider: 'mock',
          model: 'mock',
        });
        rows.push(readRun(raw));
      }
      const order = new Map(CASES.map((c: any, i: number) => [c.id, i]));
      rows.sort(
        (a: any, b: any) =>
          (order.get(a.caseId) as number) - (order.get(b.caseId) as number) || a.rep - b.rep,
      );
      const fresh = `${JSON.stringify(mockPin(rows), null, 2)}\n`;
      const pinned = readFileSync(MOCK_PIN, 'utf8');
      if (fresh !== pinned) {
        // Name the first row that moved, so a failure says where.
        const was = JSON.parse(pinned).rows;
        const moved = rows.find((r: any, i: number) => stableJson(r) !== stableJson(was[i]));
        expect(moved, 'the first moved row').toEqual(was.find((w: any) => w.key === moved?.key));
      }
      expect(fresh).toBe(pinned);
      expect(rows).toHaveLength(CASES.reduce((s: number, c: any) => s + c.mock.length, 0));
    },
    5 * 60_000,
  );
});

describe('UNIT — the baseline agent is unarmed', () => {
  it('serves the sheet’s tools byte for byte, and commits no key an armed inputs layer writes', async () => {
    const seen: any[] = [];
    const spy = {
      ...doors,
      mock: (opts: any) =>
        doors.mock({
          ...opts,
          respond: (req: any) => {
            seen.push(req);
            return opts.respond(req);
          },
        }),
    };
    const raw = await runCase({
      doors: spy,
      caseDef: caseById('p1-checkout-errors'),
      arm: 'off',
      rep: 0,
      provider: 'mock',
      model: 'mock',
    });
    expect(seen.length).toBe(2);
    for (const req of seen) {
      expect(stableJson(req.tools)).toBe(
        stableJson(
          TOOLS.map((t: any) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        ),
      );
      expect(req.systemPrompt).toContain(SYSTEM_PROMPT);
      expect(JSON.stringify(req.tools)).not.toMatch(/_findings|askOrAssume|recorded as assumed/);
    }
    const state = raw.recording.snapshot.sharedState;
    expect(state.argumentResolutions).toBeUndefined();
    expect(state.findingsLedger).toBeUndefined();
    expect(raw.standing.reasons.some((r: string) => r.startsWith('argument-'))).toBe(false);
  }, 60_000);
});
