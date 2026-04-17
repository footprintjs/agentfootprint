/**
 * agentfootprint/patterns — four canonical compositions.
 *
 * Each pattern is a thin factory over existing concepts (FlowChart, Parallel,
 * Conditional, Agent, LLMCall). The source of each pattern is short and
 * readable — use it as a teaching artifact when you build your own.
 *
 * All four demos use the `mock` adapter so the file runs deterministically
 * with no network or API keys.
 *
 * Run: npx tsx examples/orchestration/28-patterns.ts
 */

import { Agent, Conditional, LLMCall, mock } from 'agentfootprint';
import {
  planExecute,
  mapReduce,
  treeOfThoughts,
  reflexion,
} from 'agentfootprint/patterns';

async function planExecuteDemo() {
  console.log('\n── planExecute ──');
  const planner = Agent.create({
    provider: mock([{ content: '1. gather requirements\n2. draft\n3. review' }]),
  })
    .system('Plan; do not execute.')
    .build();

  const executor = Agent.create({
    provider: mock([{ content: 'Executed plan successfully.' }]),
  })
    .system('Execute the given plan step by step.')
    .build();

  const pipeline = planExecute({ planner, executor });
  const result = await pipeline.run('Write a launch announcement');
  console.log(' result:', result.content);
}

async function mapReduceDemo() {
  console.log('\n── mapReduce ──');
  const provider = mock([{ content: 'Merged: doc-0, doc-1, doc-2' }]);
  const docs = ['quarterly report', 'sales forecast', 'customer interviews'];
  const pipeline = mapReduce({
    provider,
    mappers: docs.map((doc, i) => ({
      id: `doc-${i}`,
      description: `Summarize doc ${i}`,
      runner: LLMCall.create({
        provider: mock([{ content: `summary-of-${doc.split(' ')[0]}` }]),
      })
        .system(`Summarize: ${doc}`)
        .build(),
    })),
    reduce: { mode: 'llm', prompt: 'Combine into a single executive summary.' },
  });
  const result = await pipeline.run('Produce the summary');
  console.log(' result:', result.content);
}

async function treeOfThoughtsDemo() {
  console.log('\n── treeOfThoughts ──');
  const provider = mock([{ content: 'ignored — judge provides its own' }]);
  const tot = treeOfThoughts({
    provider,
    branches: 3,
    thinker: (i) =>
      LLMCall.create({ provider: mock([{ content: `candidate answer ${i + 1}` }]) })
        .system(`Thinker ${i + 1}: propose a solution.`)
        .build(),
    judge: Agent.create({
      provider: mock([{ content: 'Best: candidate answer 2 (most specific).' }]),
    })
      .system('Pick the best answer and justify.')
      .build(),
  });
  const result = await tot.run('How should we evaluate this design?');
  console.log(' result:', result.content);
}

async function reflexionDemo() {
  console.log('\n── reflexion ──');
  const reviewer = reflexion({
    solver: Agent.create({ provider: mock([{ content: 'Initial draft.' }]) })
      .system('Draft an answer.')
      .build(),
    critic: Agent.create({
      provider: mock([{ content: 'Missing concrete examples.' }]),
    })
      .system('List weaknesses.')
      .build(),
    improver: Agent.create({
      provider: mock([{ content: 'Improved draft with examples added.' }]),
    })
      .system('Apply the critique.')
      .build(),
  });
  const result = await reviewer.run('Explain vectors in plain English.');
  console.log(' result:', result.content);
}

async function composedDemo() {
  console.log('\n── Conditional routes between planExecute and reflexion ──');
  const fast = planExecute({
    planner: LLMCall.create({ provider: mock([{ content: 'quick plan' }]) })
      .system('quick plan')
      .build(),
    executor: LLMCall.create({ provider: mock([{ content: 'fast answer' }]) })
      .system('execute')
      .build(),
  });

  const thorough = reflexion({
    solver: Agent.create({ provider: mock([{ content: 'draft' }]) })
      .system('draft')
      .build(),
    critic: Agent.create({ provider: mock([{ content: 'critique' }]) })
      .system('critique')
      .build(),
    improver: Agent.create({
      provider: mock([{ content: 'reflective answer' }]),
    })
      .system('improve')
      .build(),
  });

  const router = Conditional.create({ name: 'depth-router' })
    .when((input) => input.length < 30, fast, { id: 'fast' })
    .otherwise(thorough, { name: 'Thorough' })
    .build();

  console.log(' short :', (await router.run('hi there')).content);
  console.log(
    ' long  :',
    (
      await router.run(
        'this is a longer input that requires a more thoughtful iterative answer',
      )
    ).content,
  );
}

async function main() {
  await planExecuteDemo();
  await mapReduceDemo();
  await treeOfThoughtsDemo();
  await reflexionDemo();
  await composedDemo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
