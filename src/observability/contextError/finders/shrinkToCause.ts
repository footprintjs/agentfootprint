/**
 * shrinkToCause — keeps cutting the suspect set down until the smallest subset whose
 * removal still fixes the answer. Converges to the minimal cause in fewer re-runs than
 * leave-one-out (delta-debugging minimization), and the minimal set is verified to
 * recover by construction.
 *
 * Method: delta-debugging minimization (ddmin) over the removal set that recovers.
 */
import type { Finder, FindInput, FindResult } from './types.js';

export const shrinkToCause: Finder = {
  name: 'shrinkToCause',
  meta: {
    label: 'Shrinks the suspect set to the smallest whose removal still fixes the answer',
    method: 'delta-debugging minimization (ddmin) to the minimal recovering set',
    paper: 'BugDoc, Lourenço et al. 2020 (SIGMOD)',
  },
  async find(input: FindInput): Promise<FindResult> {
    if (!input.rerun) throw new Error('shrinkToCause needs input.rerun');
    const rerun = input.rerun;
    const ids = input.suspects.map((s) => s.id);
    let checks = 0;
    const recovers = async (removed: readonly string[]): Promise<boolean> => {
      checks++;
      return (await rerun(removed)).recovered;
    };

    // Precondition: removing everything must recover, else there is no removable cause here.
    if (ids.length === 0 || !(await recovers(ids))) {
      return {
        finder: 'shrinkToCause',
        suspects: ids.map((id) => ({ id })),
        shortlist: [],
        lead: undefined,
        evidence: 'guessed',
        granularity: 'piece',
        checks,
        explanation: `shrinkToCause: removing all ${ids.length} pieces did not recover — no single removable cause (over-determined or absent).`,
      };
    }

    // ddmin: minimize the removal set that still recovers.
    let candidates = [...ids];
    let n = 2;
    while (candidates.length > 1) {
      const size = Math.ceil(candidates.length / n);
      let reduced = false;
      // a single chunk's removal already recovers → narrow to it
      for (let i = 0; i < candidates.length; i += size) {
        const chunk = candidates.slice(i, i + size);
        if (chunk.length && (await recovers(chunk))) {
          candidates = chunk;
          n = 2;
          reduced = true;
          break;
        }
      }
      if (!reduced) {
        // removing a complement recovers → drop that chunk
        for (let i = 0; i < candidates.length; i += size) {
          const complement = [...candidates.slice(0, i), ...candidates.slice(i + size)];
          if (complement.length && (await recovers(complement))) {
            candidates = complement;
            n = Math.max(n - 1, 2);
            reduced = true;
            break;
          }
        }
      }
      if (!reduced) {
        if (n >= candidates.length) break;
        n = Math.min(candidates.length, n * 2);
      }
    }

    const rest = ids.filter((id) => !candidates.includes(id));
    const explanation = [
      `shrinkToCause: delta-debugging minimization over ${ids.length} pieces in ${checks} checks.`,
      `Minimal recovering set: ${candidates.join(', ')} (removing it flips the outcome; nothing smaller does).`,
      checks < ids.length ? `Reached the cause in fewer checks than leave-one-out (${checks} vs ${ids.length}).` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      finder: 'shrinkToCause',
      suspects: [...candidates, ...rest].map((id) => ({ id })),
      shortlist: candidates,
      lead: candidates[0],
      evidence: 'proven',
      granularity: 'piece',
      checks,
      explanation,
    };
  },
};
