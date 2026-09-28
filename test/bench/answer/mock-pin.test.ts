/**
 * BYTE IDENTITY — the answer bench's scripted run, pinned (`bench/answer/results/mock.json`).
 *
 * Every scripted variant of every case under `off`, `layer` and `line`, on the SOURCES, must
 * reproduce the rows and aggregates `node bench/answer/run.mjs --pin-mock` wrote from the BUILT
 * package — so a green run here also says the sources and the build serve the same bytes, and a
 * later step that moves an unarmed agent's requests (`requestsDigest`), the layer's standing on
 * any variant, or its guards fails here first.
 *
 * Test types:
 *   - BYTE IDENTITY — the fresh rows and aggregates equal the pin, field for field.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, caseById } from '../../../bench/answer/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { runCase } from '../../../bench/answer/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { readRun } from '../../../bench/answer/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { DEFAULTS, MOCK_PIN, mockPin, planOf, sortRows } from '../../../bench/answer/run.mjs';
import { doors } from './doors.js';

describe('BYTE IDENTITY — the pinned scripted run', () => {
  it(
    'a fresh run on the sources reproduces bench/answer/results/mock.json',
    async () => {
      const arms = DEFAULTS.mockArms.split(',');
      const plan = planOf({
        cases: CASES,
        arms,
        runs: undefined,
        seed: DEFAULTS.seed,
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
      const fresh = JSON.parse(JSON.stringify(mockPin(sortRows(rows, arms), arms)));
      const pinned = JSON.parse(readFileSync(MOCK_PIN, 'utf8'));
      expect(fresh.rows).toEqual(pinned.rows);
      expect(fresh.aggregates).toEqual(pinned.aggregates);
      expect(fresh).toEqual(pinned);
    },
    5 * 60_000,
  );
});
