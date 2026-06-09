/**
 * 04 — Parallel: fan-out + merge, strict or tolerant.
 *
 * By default, Parallel is fail-loud: if any branch throws, the whole
 * composition throws with an aggregated error. For partial-failure
 * merges (e.g., "combine whatever succeeded"), opt into tolerant mode
 * with `.mergeOutcomesWithFn()` — receives typed `{ ok, value | error }`.
 *
 * REQUIRED branches: `.branch(id, runner, { required: true })` marks a
 * branch whose failure must reject the WHOLE run (named after the
 * branch) — even under a tolerant merge. When EVERY branch is required,
 * footprintjs's fork-level `failFast` kicks in: the first failure aborts
 * immediately instead of waiting for slow siblings.
 *
 * Run:  npx tsx examples/04-parallel.ts
 */

import { Parallel, LLMCall } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'core-flow/02-parallel',
  title: 'Parallel — fan-out + merge (strict / tolerant)',
  group: 'core-flow',
  description:
    'Fan out to N branches and merge. Fail-loud by default; opt into tolerant mode with .mergeOutcomesWithFn().',
  defaultInput: 'Can we ship feature X?',
  providerSlots: ['default'],
  tags: ['composition', 'Parallel', 'merge', 'tolerant'],
};

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  // The LLMCall's `id` matches the branch member id (the `tag`) so
  // the runtime engine subflowId (`legal`, `ethics`) lines up with
  // the chart node's composition id. That alignment lets Lens's
  // slider-sync highlight the right card as the cursor scrubs.
  const brief = (tag: string) =>
    LLMCall.create({
      id: tag,
      name: `${tag} reviewer`,
      provider: provider ?? exampleProvider('core-flow', { reply: `${tag} review: looks good.` }),
      model: 'mock',
    })
      .system(`You are a ${tag} reviewer. Give one line.`)
      .build();

  // Mode selection: type `tolerant ...` in the input box to run the
  // 3-agent tolerant committee; anything else runs the 2-agent strict one.
  // Keeping ONE Parallel per click keeps the Lens flowchart focused on
  // a single fan-out shape at a time (otherwise the chart shows two
  // Parallel sub-runs stacked sequentially, which is harder to read).
  const mode: 'strict' | 'tolerant' = /^\s*tolerant\b/i.test(input) ? 'tolerant' : 'strict';
  const cleanInput = input.replace(/^\s*tolerant\b\s*:?\s*/i, '');

  // #region build
  if (mode === 'strict') {
    // STRICT (default), 2 BRANCHES: any branch failure → whole Parallel throws.
    // The smaller committee is the most common shape — two specialists vote.
    // Both votes are REQUIRED (losing 1 of 2 is not fine), so each branch
    // is marked `{ required: true }`: with every branch required, the
    // fan-out runs fail-fast — the first failure rejects the whole run
    // immediately, naming the branch, without waiting on the sibling.
    const committee = Parallel.create({ name: 'Committee' })
      .branch('legal', brief('legal'), { required: true })
      .branch('ethics', brief('ethics'), { required: true })
      .mergeWithFn((results) =>
        Object.entries(results)
          .map(([id, r]) => `  ${id}: ${r}`)
          .join('\n'),
      )
      .build();

    console.log('--- strict mode (2 agents) ---');
    const strict = await committee.run({ message: cleanInput });
    console.log(strict);
    return { mode, strict };
  }

  // TOLERANT, 3 BRANCHES: the merge fn receives the full outcomes map so
  // it can decide how to handle partial failure. Larger committees are
  // also where tolerant mode pays off — losing 1 of 3 voices is fine,
  // losing 1 of 2 is not.
  const tolerantCommittee = Parallel.create({ name: 'TolerantCommittee' })
    .branch('legal', brief('legal'))
    .branch('ethics', brief('ethics'))
    .branch('cost', brief('cost'))
    .mergeOutcomesWithFn((outcomes) => {
      const lines = Object.entries(outcomes).map(([id, o]) =>
        o.ok ? `  ${id}: ${o.value}` : `  ${id}: [FAILED] ${o.error}`,
      );
      return lines.join('\n');
    })
    .build();
  // #endregion build

  console.log('--- tolerant mode (3 agents) ---');
  const tolerant = await tolerantCommittee.run({ message: cleanInput });
  console.log(tolerant);
  return { mode, tolerant };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
