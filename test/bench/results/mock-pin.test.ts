/**
 * The results bench on the scripted mock — its OWN byte reference, and the off arm unarmed.
 *
 * Test types:
 *   - BYTE IDENTITY — a fresh mock run on the sources (every scripted variant of every case, under
 *                     each of its arms) equals `bench/results/results/mock.json` byte for byte:
 *                     every row, every aggregate, the verdict, and every served request's digest.
 *                     `node bench/results/run.mjs --pin-mock` regenerates it from the BUILT
 *                     package — so a green run here also says the sources and the build agree;
 *   - INTEGRATION   — the off arm mounts nothing and files nothing (no period row, no period
 *                     reason, no `period` on the wire); the on arm files one row per read and the
 *                     standing names the planted reason;
 *   - SECURITY      — the harness refuses to run `on` against a build without the layer, instead
 *                     of running it unarmed.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, caseById } from '../../../bench/results/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { buildAgent, buildTools, runCase } from '../../../bench/results/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { readRun } from '../../../bench/results/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { DEFAULTS, MOCK_PIN, mockPin, planOf, sortRows } from '../../../bench/results/run.mjs';
import { doors } from './doors.js';

async function mockRun() {
  const plan = planOf({ cases: CASES, runs: undefined, seed: DEFAULTS.mockSeed, provider: 'mock' });
  const raws: any[] = [];
  for (const item of plan) {
    raws.push(
      await runCase({
        doors,
        caseDef: caseById(item.caseId),
        arm: item.arm,
        rep: item.rep,
        provider: 'mock',
        model: 'mock',
      }),
    );
  }
  return raws;
}

describe('BYTE IDENTITY — the pinned mock run', () => {
  it(
    'a fresh run on the sources reproduces bench/results/results/mock.json',
    async () => {
      const raws = await mockRun();
      const rows = sortRows(raws.map(readRun));
      const digests = Object.fromEntries(
        [...raws]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((r) => [r.key, r.requests.map((q: any) => q.digest).join('.')]),
      );
      const fresh = `${JSON.stringify(mockPin(rows, digests), null, 2)}\n`;
      const pinned = readFileSync(MOCK_PIN, 'utf8');
      if (fresh !== pinned) {
        const was = JSON.parse(pinned);
        const moved = rows.find(
          (r: any, i: number) => JSON.stringify(r) !== JSON.stringify(was.rows[i]),
        );
        expect(moved, 'the first moved row').toEqual(
          was.rows.find((w: any) => w.key === moved?.key),
        );
        expect(digests).toEqual(was.requestsDigests);
      }
      expect(fresh).toBe(pinned);
      const expected = CASES.reduce((s: number, c: any) => s + c.mock.length * c.arms.length, 0);
      expect(rows).toHaveLength(expected);
    },
    5 * 60_000,
  );
});

describe('INTEGRATION — off mounts nothing, on files the planted verdict', () => {
  it('off: no period row, no period reason, no period on the wire; on: not-held on the stale export', async () => {
    const caseDef = caseById('r1-backups-last-hour');
    const off = await runCase({
      doors,
      caseDef,
      arm: 'off',
      rep: 0,
      provider: 'mock',
      model: 'mock',
    });
    const on = await runCase({
      doors,
      caseDef,
      arm: 'on',
      rep: 0,
      provider: 'mock',
      model: 'mock',
    });
    const offState = off.recording.snapshot.sharedState;
    expect(offState.findingsLedger).toBeUndefined();
    expect(off.standing.reasons.filter((r: string) => r.startsWith('period-'))).toEqual([]);
    const offTool = offState.history.find((m: any) => m.role === 'tool');
    expect(offTool.content).not.toContain('"period"');
    expect(offTool.content).toContain('taken at 2026-09-26 02:00 UTC');

    const onState = on.recording.snapshot.sharedState;
    const rows = onState.findingsLedger.filter((r: any) => r.kind === 'period');
    expect(rows.map((r: any) => [r.toolName, r.verdict])).toEqual([
      ['backup_failures', 'not-held'],
    ]);
    expect(on.standing.reasons).toContain('period-not-held');
    const onTool = onState.history.find((m: any) => m.role === 'tool');
    expect(onTool.content).toContain('"period"');
    expect(onTool.content).not.toContain('taken at');
    expect(readRun(on).foldAgrees).toBe(true);
  }, 60_000);
});

describe('SECURITY — an arm the build cannot arm is refused', () => {
  it('refuses on when the builder has no resultsLayer()', () => {
    const noLayer = {
      ...doors,
      Agent: {
        // A builder from before step 7b: every other method, no resultsLayer().
        create: () => {
          const b: any = { system: () => b, tools: () => b, build: () => ({}) };
          return b;
        },
      },
    };
    const tools = buildTools(doors, 'on', {}, []);
    expect(() =>
      buildAgent(noLayer, 'on', doors.mock({ replies: [{ content: 'x' }] }), 'mock', tools),
    ).toThrow(/Refusing to run the arm unarmed/);
  });
});
