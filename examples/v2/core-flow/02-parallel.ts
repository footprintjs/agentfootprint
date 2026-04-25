/**
 * 04 — Parallel: fan-out + merge, strict or tolerant.
 *
 * By default, Parallel is fail-loud: if any branch throws, the whole
 * composition throws with an aggregated error. For partial-failure
 * merges (e.g., "combine whatever succeeded"), opt into tolerant mode
 * with `.mergeOutcomesWithFn()` — receives typed `{ ok, value | error }`.
 *
 * Run:  npx tsx examples/v2/04-parallel.ts
 */

import { Parallel, LLMCall, MockProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/core-flow/02-parallel',
  title: 'Parallel — fan-out + merge (strict / tolerant)',
  group: 'v2-core-flow',
  description: 'Fan out to N branches and merge. Fail-loud by default; opt into tolerant mode with .mergeOutcomesWithFn().',
  defaultInput: 'Can we ship feature X?',
  providerSlots: ['default'],
  tags: ['v2', 'composition', 'Parallel', 'merge', 'tolerant'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  const brief = (tag: string) =>
    LLMCall.create({
      provider: new MockProvider({ reply: `${tag} review: looks good.` }),
      model: 'mock',
    })
      .system(`You are a ${tag} reviewer. Give one line.`)
      .build();

  // STRICT (default): any branch failure → whole Parallel throws
  const committee = Parallel.create({ name: 'Committee' })
    .branch('legal', brief('legal'))
    .branch('ethics', brief('ethics'))
    .branch('cost', brief('cost'))
    .mergeWithFn((results) =>
      Object.entries(results)
        .map(([id, r]) => `  ${id}: ${r}`)
        .join('\n'),
    )
    .build();

  console.log('--- strict mode ---');
  const strict = await committee.run({ message: input });
  console.log(strict);

  // TOLERANT: merge fn receives the full outcomes map
  const tolerantCommittee = Parallel.create({ name: 'TolerantCommittee' })
    .branch('legal', brief('legal'))
    .branch('ethics', brief('ethics'))
    .mergeOutcomesWithFn((outcomes) => {
      const lines = Object.entries(outcomes).map(([id, o]) =>
        o.ok ? `  ${id}: ${o.value}` : `  ${id}: [FAILED] ${o.error}`,
      );
      return lines.join('\n');
    })
    .build();

  console.log('\n--- tolerant mode ---');
  const tolerant = await tolerantCommittee.run({ message: input });
  console.log(tolerant);

  return { strict, tolerant };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
