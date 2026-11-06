/**
 * formatContextBugReport — a localizer report as plain text.
 */

import { suspectLabel } from './ablation.js';
import { classifySuspect } from './cost.js';
import type { ContextBugReport } from './types.js';

/**
 * Human-readable report. The claim tiers are spelled out in the output
 * itself (§B2): scores are proxies; verdict lines are the only causal
 * claims; every ⚠ honesty flag prints.
 */
export function formatContextBugReport(report: ContextBugReport): string {
  const lines: string[] = [];
  lines.push(
    `CONTEXT BUG LOCALIZATION — trigger ${report.step} "${report.stepName}" ` +
      `(${report.triggerSource}${
        report.triggerScore !== undefined ? `, score ${report.triggerScore.toFixed(2)}` : ''
      })`,
  );
  const modeLine =
    report.mode === 'causal'
      ? 'mode: CAUSAL — ranked proxies + counterfactual ablation verdicts (verdicts are the only causal claims)'
      : 'mode: CORRELATIONAL — ranking only; every score is an embedding-geometry proxy, no causal claim is made';
  lines.push(
    report.rankedBy !== undefined ? `${modeLine} — ranked by ${report.rankedBy}` : modeLine,
  );
  const s = report.sliceStats;
  lines.push(
    `slice: ${s.nodes} nodes · ${s.dataEdges} data edges · ${s.controlEdges} control edges · ` +
      `${s.weightedEdges} influence-weighted`,
  );

  if (report.conclusion !== undefined) {
    lines.push('', `CONCLUSION (${report.conclusion.kind}): ${report.conclusion.statement}`);
  }

  lines.push('', `SUSPECTS (${report.suspects.length}, ranked by correlational proxy score):`);
  report.suspects.forEach((suspect, i) => {
    const scoreParts =
      suspect.semanticScore !== undefined
        ? `${suspect.score.toFixed(3)} (path ${suspect.structuralScore.toFixed(
            3,
          )} × content ${suspect.semanticScore.toFixed(3)})`
        : `${suspect.score.toFixed(3)} (path only — no content signal; an upper bound)`;
    lines.push(
      `${String(i + 1).padStart(2)}. [${suspectLabel(suspect)}] at ${suspect.source} ` +
        `"${suspect.stageName}" — score ${scoreParts}`,
    );
    if (suspect.edgePath.length > 0) {
      const hops = suspect.edgePath
        .map((hop) => {
          const link =
            hop.kind === 'control'
              ? `[control${hop.key ? `: ${hop.key}` : ''}]`
              : hop.key ?? 'data';
          const weight = hop.weight !== 1 ? ` ${hop.weight.toFixed(3)}` : '';
          return `←(${link}${weight})— ${hop.to}`;
        })
        .join(' ');
      lines.push(`    path: ${suspect.edgePath[0].from} ${hops}`);
    }
    if (suspect.verdict !== undefined && suspect.runs !== undefined) {
      lines.push(`    verdict: ${suspect.verdict.claim}`);
      lines.push(
        `    runs: ${suspect.runs.flips}/${suspect.runs.samples} flipped · similarity to original ` +
          `${suspect.runs.similarity.mean.toFixed(3)} ± ${suspect.runs.similarity.stdev.toFixed(
            3,
          )} ` +
          `[${suspect.runs.similarity.min.toFixed(3)}, ${suspect.runs.similarity.max.toFixed(3)}]`,
      );
      if (suspect.cost !== undefined) {
        const c = suspect.cost;
        const detail = c.reducedCostOnRemoval
          ? `REDUCED on removal — −${c.loopsSaved} loop(s), −${c.tokensSaved} tok (beats placebo, stable)`
          : `no cost effect (loops ${c.loopsSaved >= 0 ? '−' : '+'}${Math.abs(c.loopsSaved)}${
              c.stable ? '' : '; no placebo band / unstable'
            })`;
        lines.push(`    cost: ${detail} → class: ${classifySuspect(suspect)}`);
      }
    } else if (report.mode === 'correlational') {
      lines.push(
        '    verdict: (none — correlational ranking only; supply an AblationRunner to test causally)',
      );
    }
  });

  // Missing-context tier (interface #3) — symmetric with the SUSPECTS block.
  if (report.dropped !== undefined && report.dropped.length > 0) {
    lines.push(
      '',
      `MISSING CONTEXT (${report.dropped.length} dropped — available but never sent to the model):`,
    );
    report.dropped.forEach((c, i) => {
      lines.push(`${String(i + 1).padStart(2)}. [dropped '${c.id}']`);
      if (c.verdict !== undefined && c.runs !== undefined) {
        lines.push(`    verdict: ${c.verdict.claim}`);
        lines.push(
          `    runs: ${c.runs.flips}/${c.runs.samples} flipped on restore · similarity to original ` +
            `${c.runs.similarity.mean.toFixed(3)} ± ${c.runs.similarity.stdev.toFixed(3)}`,
        );
      } else {
        lines.push(
          '    verdict: (none — candidate only; supply missingContext.rerun to confirm by restoration)',
        );
      }
    });
  }

  if (report.baseline !== undefined) {
    lines.push(
      '',
      `baseline (no ablation): ${report.baseline.flips}/${report.baseline.samples} flipped · ` +
        `similarity ${report.baseline.similarity.mean.toFixed(
          3,
        )} ± ${report.baseline.similarity.stdev.toFixed(3)}`,
    );
  }

  if (report.restorationBaseline !== undefined) {
    lines.push(
      `baseline (no restoration): ${report.restorationBaseline.flips}/${report.restorationBaseline.samples} flipped · ` +
        `similarity ${report.restorationBaseline.similarity.mean.toFixed(
          3,
        )} ± ${report.restorationBaseline.similarity.stdev.toFixed(3)}`,
    );
  }

  if (report.honestyFlags.length > 0) {
    lines.push('', 'HONESTY:');
    for (const flag of report.honestyFlags) lines.push(`⚠ [${flag.flag}] ${flag.note}`);
  }
  lines.push(
    '',
    'claims: scores/weights are deterministic embedding-geometry PROXIES (semantic alignment, ' +
      'not model internals); slice completeness is bounded by tracking (see HONESTY); only ' +
      'ablation verdicts make causal claims.',
  );
  return lines.join('\n');
}
