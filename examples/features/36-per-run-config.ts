/**
 * 36 — Per-run configuration: `.configure()`.
 *
 * One agent, many runs, and not every run wants the same model or the
 * same house rules. A long message may deserve the bigger model; a
 * tenant may have its own policy text; a canary may want last week's
 * prompt. Rebuilding the agent per request works and is wasteful.
 * Mutating one is worse: the trace then describes an agent that no
 * longer exists.
 *
 * `.configure((ctx) => ({ model?, instructions? }))` resolves ONCE per
 * run, at the start of the run, and what it returns is COMMITTED to the
 * trace before the first LLM call. So `agent.getLastSnapshot()` says
 * which model actually answered — not which one the agent was built
 * with. A run that changed its own model without recording it would be
 * a trace that lies about its most expensive fact.
 *
 * Tools are the OTHER axis and already have an owner: `.toolProvider()`,
 * consulted every iteration.
 *
 * Run:  npm run example examples/features/36-per-run-config.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/36-per-run-config',
  title: 'Per-run config — .configure()',
  group: 'features',
  description:
    'Resolve this run model and system prompt at run start, and commit what was ' +
    'resolved to the trace so the recording says which model actually answered.',
  defaultInput: 'My package never arrived.',
  providerSlots: ['default'],
  tags: ['features', 'configuration', 'multi-tenant', 'model-routing', 'trace'],
};

const HOUSE_RULES: Record<string, string> = {
  acme: 'ACME policy: never quote a delivery date you cannot guarantee.',
  globex: 'GLOBEX policy: always answer in French.',
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const llm = provider ?? mock({ replies: ['Looking into it now.', 'Je vérifie tout de suite.'] });

  // #region configure
  const agent = Agent.create({ provider: llm, model: 'small-model' })
    .system('You answer support questions.')
    .configure(({ message, identity, defaults }) => ({
      // Route to the bigger model only when the question is big.
      ...(message.length > 40 ? { model: 'big-model' } : {}),
      // Tenant rules land on top of the built-in prompt. `defaults` carries
      // what the agent was BUILT with, so nothing has to be restated here.
      instructions: `${defaults.instructions}\n${HOUSE_RULES[identity?.tenant ?? ''] ?? ''}`.trim(),
    }))
    .build();
  // #endregion configure

  const seen: { model: string }[] = [];
  agent.on('agentfootprint.stream.llm_start', (event) => {
    seen.push({ model: (event.payload as { model: string }).model });
  });

  // ── Run 1: a short message from ACME. ──
  const first = await agent.run({
    message: input,
    identity: { tenant: 'acme', conversationId: 'c1' },
  });
  const acme = agent.getLastSnapshot()?.sharedState as {
    resolvedModel?: string;
    resolvedInstructions?: string;
  };
  console.log('run 1 — tenant acme');
  console.log(`  model called      : ${seen[0]?.model}`);
  console.log(`  model COMMITTED   : ${acme.resolvedModel ?? '(default, nothing to record)'}`);
  console.log(`  rules COMMITTED   : ${acme.resolvedInstructions?.split('\n').pop()}`);

  // ── Run 2: a long message from GLOBEX. Same agent object. ──
  await agent.run({
    message: `${input} ${'This is a much longer complaint. '.repeat(3)}`,
    identity: { tenant: 'globex', conversationId: 'c2' },
  });
  const globex = agent.getLastSnapshot()?.sharedState as {
    resolvedModel?: string;
    resolvedInstructions?: string;
  };
  console.log('\nrun 2 — tenant globex, longer message');
  console.log(`  model called      : ${seen[1]?.model}`);
  console.log(`  model COMMITTED   : ${globex.resolvedModel}`);
  console.log(`  rules COMMITTED   : ${globex.resolvedInstructions?.split('\n').pop()}`);

  console.log(
    '\nBoth runs came from ONE built agent, and each run recording carries the ' +
      'model and rules that run actually used.',
  );

  if (typeof first !== 'string') throw new Error('Agent paused unexpectedly.');
  return first;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
