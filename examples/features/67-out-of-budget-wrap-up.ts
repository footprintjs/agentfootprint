/**
 * 67 — running out of budget ends with an honest summary, not a fragment (9.56.0).
 *
 * THE DEFECT, from two real recorded runs of the same shape. An agent with
 * `maxIterations: 2` was still mid-task when the budget ran out. The loop
 * stopped, and the turn's "final answer" was whatever text happened to ride
 * the last call:
 *
 *   > "The third finding focus is not settling… Let me check what's on screen
 *   > now:"
 *
 * That sentence went to the person as if it were the answer. The status was
 * `'ok'`. Nothing on the record said the budget had run out, and the model
 * never got a chance to wrap up.
 *
 * WHAT HAPPENS NOW, and what this file demonstrates in order:
 *
 *   1. The run spends ONE more LLM call, with the TOOLS WITHHELD, carrying one
 *      instruction — and hands back what comes back. That call cannot loop: a
 *      model that was offered no tools has nothing to ask for, which is why it
 *      is exempt from `maxIterations` by construction rather than by a rule.
 *   2. The fact is on the record three ways — `agent.stoppedEarly()` (now with
 *      `wrappedUp: true`), the `agentfootprint.agent.budget_exhausted` event,
 *      and a `stoppedEarly` field on `turn_end`, which is the event a
 *      dashboard already reads to draw an outcome chip.
 *   3. `wrapUpAtMaxIterations: false` reproduces the old behaviour exactly:
 *      no extra call, the fragment as the answer, and the same fact filed as
 *      `action: 'cut-short'` so a consumer can still tell what happened.
 *
 * …and one thing it proves by absence: an agent that finishes inside its
 * budget files no `budget_exhausted`, stamps nothing on `turn_end`, and
 * commits not one new key. The feature costs nothing to a turn that never
 * runs out.
 *
 * Run:  npm run example examples/features/67-out-of-budget-wrap-up.ts
 */

import { Agent, defineTool, type LLMProvider, type LLMRequest } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/67-out-of-budget-wrap-up',
  title: 'Out of budget — the turn ends with a summary, not a fragment',
  group: 'features',
  description:
    'When maxIterations runs out mid-task, the run spends one more LLM call with the tools ' +
    'withheld, asking for a final answer — what was done, what was not, what the person should ' +
    'know. The fact rides agent.stoppedEarly({ wrappedUp }), agentfootprint.agent.' +
    'budget_exhausted and turn_end, so a dashboard can tell "answered" from "answered after the ' +
    'budget ran out". Opt out with wrapUpAtMaxIterations: false.',
  defaultInput: 'Audit the three findings in the report',
  providerSlots: ['default'],
  tags: ['features', 'agent', 'limits', 'observability'],
};

const FRAGMENT = "The third finding focus is not settling… Let me check what's on screen now:";

const check = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`example assertion failed: ${what}`);
};

/** The tool the agent keeps reaching for — it never runs out of things to look at. */
const inspect = defineTool({
  name: 'inspect_finding',
  description: 'Inspect one finding in the report',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'finding inspected: status unclear',
} as never);

/**
 * A provider that behaves exactly like the one in the recorded runs: it always
 * wants another tool call — until the call it is handed offers no tools, at
 * which point it can only answer.
 */
function busyModel(seen: { tools: number }[]): LLMProvider {
  return mock({
    respond: (req: LLMRequest) => {
      const tools = req.tools?.length ?? 0;
      seen.push({ tools });
      if (tools === 0) {
        return (
          'I checked findings 1 and 2 and both hold up. Finding 3 never settled, so it is ' +
          'still unverified — re-run that one before you rely on the report.'
        );
      }
      return {
        content: FRAGMENT,
        toolCalls: [{ id: `c${String(seen.length)}`, name: 'inspect_finding', args: {} }],
      };
    },
  }) as LLMProvider;
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // ── 1. The default: the turn wraps up ─────────────────────────────────
  // #region wrap-up
  const seen: { tools: number }[] = [];
  const agent = Agent.create({
    provider: provider ?? busyModel(seen),
    model: 'demo-sonnet',
    maxIterations: 2, // a deliberately small action budget
  })
    .tool(inspect as never)
    .build();

  let exhausted: Record<string, unknown> | undefined;
  agent.on('agentfootprint.agent.budget_exhausted', (e) => {
    exhausted = e.payload as unknown as Record<string, unknown>;
  });

  const answer = await agent.run({ message: input });
  const cut = agent.stoppedEarly();
  // #endregion wrap-up

  console.log('1. The answer the person receives:');
  console.log(`   ${answer}\n`);
  console.log('   …and NOT the fragment the loop stopped in the middle of:');
  console.log(`   "${FRAGMENT}"\n`);

  if (provider === undefined) {
    check(seen.length === 3, 'two budgeted calls, then one wrap-up call');
    check(seen[2]?.tools === 0, 'the wrap-up call offers ZERO tools');
    check(!String(answer).includes('Let me check'), 'the fragment is not the answer');
    console.log('2. The calls the run made:');
    seen.forEach((s, i) =>
      console.log(
        `   call ${String(i + 1)}: ${String(s.tools)} tool(s) offered` +
          (s.tools === 0 ? '  ← the wrap-up: nothing to ask for, so it can only answer' : ''),
      ),
    );
    console.log('');
  }

  console.log('3. The fact, on the record:');
  console.log(`   agent.stoppedEarly() → ${JSON.stringify(cut)}`);
  console.log(`   agent.budget_exhausted → ${JSON.stringify(exhausted)}`);
  console.log(
    '   `wrappedUp: true` + `action: "wrapped-up"` is what separates "answered"\n' +
      '   from "answered after the budget ran out" — the same run, two very\n' +
      '   different things to show a person.\n',
  );

  if (provider !== undefined) return answer;

  check(cut?.wrappedUp === true, 'the committed record says the turn was wrapped up');
  check(exhausted?.action === 'wrapped-up', 'the event says the same thing');

  // ── 2. The opt-out: the pre-9.56.0 turn, exactly ──────────────────────
  const seenOff: { tools: number }[] = [];
  const cutShort = Agent.create({
    provider: busyModel(seenOff),
    model: 'demo-sonnet',
    maxIterations: 2,
    wrapUpAtMaxIterations: false,
  })
    .tool(inspect as never)
    .build();

  let cutShortEvent: Record<string, unknown> | undefined;
  cutShort.on('agentfootprint.agent.budget_exhausted', (e) => {
    cutShortEvent = e.payload as unknown as Record<string, unknown>;
  });
  const fragment = await cutShort.run({ message: input });

  check(seenOff.length === 2, 'no extra call was spent');
  check(fragment === FRAGMENT, 'the answer is the fragment, as it was before 9.56.0');
  check(cutShortEvent?.action === 'cut-short', 'the fact is still filed, as cut-short');
  console.log('4. With `wrapUpAtMaxIterations: false` — the old behaviour, exactly:');
  console.log(`   answer   → "${String(fragment)}"`);
  console.log(`   the fact → ${JSON.stringify(cutShortEvent)}`);
  console.log('   Still recorded, still routable. Only the extra call is gone.\n');

  // ── 3. Proof by absence: a turn that finishes costs nothing ───────────
  const finishes = Agent.create({
    provider: mock({ respond: () => 'All three findings check out.' }) as LLMProvider,
    model: 'demo-sonnet',
    maxIterations: 5,
  })
    .tool(inspect as never)
    .build();
  let anyEvent = 0;
  finishes.on('agentfootprint.agent.budget_exhausted', () => (anyEvent += 1));
  await finishes.run({ message: input });

  check(anyEvent === 0, 'a turn inside its budget files no budget_exhausted');
  check(finishes.stoppedEarly() === undefined, 'and commits no stoppedEarly record');
  console.log('5. A turn that finishes inside its budget files ZERO of this —');
  console.log('   same calls, same events, same committed keys as every earlier release.');

  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
