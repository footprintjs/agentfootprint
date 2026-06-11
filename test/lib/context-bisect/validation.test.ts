/**
 * Falsifiable validation (RFC-003 §B2) — does the CORRELATIONAL ranking
 * actually point at causes?
 *
 * The claim under test: across planted-bug scenarios, ablating the
 * TOP-ranked ablatable suspect flips the outcome more often than ablating
 * the BOTTOM-ranked one. If this fails, the ranking proxy is no better
 * than noise and the docs' usefulness claim is falsified — that is the
 * point of the test.
 *
 * Procedure (per scenario variant): run the buggy agent → localize WITHOUT
 * rerun (pure ranking) → counterfactually ablate the top vs the bottom
 * ablatable suspect (N seeded reruns each, domain comparator) → tally.
 */
import { describe, expect, it } from 'vitest';

import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { embeddingCache } from '../../../src/lib/influence-core';
import {
  localizeContextBug,
  probeFlipped,
  runAblationProbe,
} from '../../../src/lib/context-bisect';
import { decisionChanged, plantedScenario, runPlantedScenario } from './plantedFactFixture';

describe('context-bisect — falsifiable ranking validation (§B2)', () => {
  it(
    'ablating the top-ranked suspect flips the outcome more often than the bottom-ranked',
    { timeout: 90000 },
    async () => {
      let topFlips = 0;
      let bottomFlips = 0;
      const scenarios = [0, 1, 2];

      for (const variant of scenarios) {
        const scenario = plantedScenario(variant);
        const original = await runPlantedScenario(scenario);
        expect(original.content).toContain('APPROVED'); // the planted bug manifests

        const report = await localizeContextBug({
          artifacts: {
            snapshot: original.snapshot,
            controlDeps: original.controlDeps,
            events: original.events,
          },
          embedder: embeddingCache(mockEmbedder()),
          atStep: original.lastLlmCallId,
        });
        expect(report.mode).toBe('correlational');

        const ablatable = report.suspects.filter(
          (suspect) => suspect.ablation !== undefined && suspect.ablation.kind !== 'arg',
        );
        expect(ablatable.length).toBeGreaterThanOrEqual(2);
        const top = ablatable[0];
        const bottom = ablatable[ablatable.length - 1];

        const probe = {
          embedder: embeddingCache(mockEmbedder()),
          rerun: {
            runner: async (specs: Parameters<typeof runPlantedScenario>[1]) =>
              (await runPlantedScenario(scenario, specs)).content,
            originalOutput: original.content,
            samples: 2,
            outcomeChanged: decisionChanged,
          },
        };
        if (probeFlipped(await runAblationProbe(probe, [top.ablation!]))) topFlips++;
        if (probeFlipped(await runAblationProbe(probe, [bottom.ablation!]))) bottomFlips++;
      }

      // The falsifiable claim. With this fixture the expected tally is 3 vs 0;
      // the assertion is the strict inequality — anything else falsifies the
      // ranking's usefulness claim.
      expect(topFlips).toBeGreaterThan(bottomFlips);
      expect(topFlips).toBe(scenarios.length); // every planted fact found at rank 1
    },
  );
});
