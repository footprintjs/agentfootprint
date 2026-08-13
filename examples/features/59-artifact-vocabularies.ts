/**
 * 59 — Artifact vocabularies: the data legs, checkable BEFORE the run.
 *
 * Example 57 showed a ref genuinely riding a tool argument at run time. This
 * one is about the declaration that makes that flow *checkable* while you are
 * still writing it — the two programs (the claim-check store and the skill
 * graph) joined:
 *
 *   1. A skill declares `produces` / `consumes` — artifact KINDS, the same
 *      consumer vocabulary a ticket carries (`'dataset/rows'`). A STEP can
 *      declare them too, which is what makes one skill's internal hand-off
 *      checkable: step 1 produces the dataset, step 2 consumes it.
 *   2. `graph.checkup()` warns `artifact-kind-unsatisfied` when a consumer
 *      needs a kind that NOTHING on the agent claims to make. Here the
 *      'reporting' skill is wired correctly and stays silent; the 'auditing'
 *      skill consumes a kind nobody produces, and the warning names it.
 *   3. The honest half, demonstrated rather than argued: the 'archiving'
 *      skill also consumes a kind nothing on this agent produces — and gets
 *      NO warning, because it carries a tool that declares `wants` for it.
 *      That is a real redemption path (the framework resolves the ref at
 *      dispatch, from a store that OUTLIVES the turn), so calling it
 *      unsatisfied would be a false alarm on the one flow the framework
 *      explicitly supports.
 *
 * The check reads DECLARATIONS only. It cannot see a tool that mints without
 * declaring, a store seeded by last night's job, or another agent's output —
 * which is exactly why it is a WARNING and never an error, and why its own
 * message says so. It is a lint for a real class of mistake, not a proof.
 *
 * Vocabularies are zero-cost: a skill that declares none is byte-identical to
 * one that never heard of them (asserted at the end of this run).
 *
 * The cloud stores are shown CONFIG-ONLY at the bottom — swapping the
 * constructor is the whole change, and this example never reaches a network.
 */

import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  canStreamArtifacts,
  type ArtifactStore,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from '../../src/index.js';
import {
  defineSkill,
  skillGraph,
  vocabularyOf,
  type Injection,
} from '../../src/doors/context.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/59-artifact-vocabularies',
  title: 'Artifact vocabularies (produces / consumes + the build-time check)',
  group: 'features',
  description:
    "A skill declares which artifact kinds it produces and consumes, and graph.checkup() warns when a consumer needs a kind nothing on the agent makes — while staying silent on the legitimate runtime flow, where a wants-declaring tool redeems the ref from a store that outlives the turn.",
  defaultInput: 'Report on Q3 sales',
  providerSlots: ['default'],
  tags: ['artifacts', 'skills', 'vocabularies', 'checkup', 'produces', 'consumes'],
};

// #region tools
/** Step 1's tool: it MAKES the dataset. */
const fetchRows = defineTool({
  name: 'fetch_rows',
  description: 'Fetch the sales rows',
  execute: () => JSON.stringify({ rows: [['north', 41], ['south', 37]] }),
});

/** Step 2's tool: it needs what step 1 made. */
const renderChart = defineTool({
  name: 'render_chart',
  description: 'Render the rows as a chart spec',
  execute: () => JSON.stringify({ chart: 'bar', series: 'sales' }),
});

/**
 * The honest escape hatch: this tool declares `wants`, so the framework
 * resolves an `art_…` ref into the payload BEFORE execute — from a store that
 * outlives the turn. A kind it consumes therefore needs no local producer.
 */
const archiveDataset = defineTool({
  name: 'archive_dataset',
  description: 'Archive a dataset somebody else produced',
  inputSchema: {
    type: 'object',
    properties: { dataset: { type: 'string', description: 'the dataset ref' } },
    required: ['dataset'],
  },
  wants: { dataset: 'dataset/rows' },
  execute: () => 'archived',
});
// #endregion tools

// #region vocabularies
/** WIRED: step 1 produces what step 2 consumes, and the skill's own legs agree. */
const reporting = defineSkill({
  id: 'reporting',
  description: 'turn sales rows into a chart spec',
  body: 'Fetch the rows, then render them.',
  produces: ['chart/spec'],
  tools: [fetchRows, renderChart],
  steps: [
    { tool: 'fetch_rows', note: 'pull the rows first', produces: ['dataset/rows'] },
    { tool: 'render_chart', note: 'then draw them', consumes: ['dataset/rows'] },
  ],
});

/** THE GAP: consumes a kind nothing on this agent declares it produces. */
const auditing = defineSkill({
  id: 'auditing',
  description: 'audit a forecast',
  body: 'Check the forecast against policy.',
  consumes: ['forecast/model'],
  tools: [defineTool({ name: 'check_policy', description: 'check', execute: () => 'ok' })],
});

/** NOT a gap: nothing here produces 'dataset/rows' either — but the tool
 *  `wants` it, which is a real redemption path. No warning. */
const archiving = defineSkill({
  id: 'archiving',
  description: 'archive a dataset from an earlier run',
  body: 'Archive the dataset you were handed.',
  consumes: ['dataset/rows'],
  tools: [archiveDataset],
});
// #endregion vocabularies

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const lines: string[] = [];

  // #region checkup
  const graph = skillGraph({
    skills: [reporting, auditing, archiving],
    start: 'reporting',
    check: 'off',
  });

  const problems = graph
    .checkup()
    .problems.filter((p) => p.code === 'artifact-kind-unsatisfied');

  lines.push(`checkup: ${problems.length} artifact-kind-unsatisfied warning(s)`);
  for (const problem of problems) {
    // The FIRST sentence is the finding; the rest is the boundary statement.
    lines.push(`  • [${problem.kind}] ${problem.message.split('.')[0]}.`);
  }
  // It is a warning, never an error — the graph is still ok.
  lines.push(`  graph ok (warnings never fail a build): ${graph.checkup().ok}`);
  // #endregion checkup

  // #region honesty
  // 'archiving' consumes a kind nobody produces and is NOT flagged: its tool
  // declares wants, so the ref is redeemed at dispatch from a store that
  // outlives the turn. A warning here would be the false alarm.
  const flagged = new Set(problems.map((p) => p.skill));
  lines.push(
    `  'archiving' consumes 'dataset/rows' with no local producer → flagged? ` +
      `${flagged.has('archiving')} (its tool wants the kind — a real runtime flow)`,
  );
  // #endregion honesty

  // #region zero-cost
  // A skill that declares nothing is byte-identical to one that never heard
  // of vocabularies: the metadata bag grows no keys.
  const plain: Injection = defineSkill({ id: 'plain', description: 'p', body: 'p' });
  lines.push(
    `  zero-cost: a skill without vocabularies reads back as ` +
      `${String(vocabularyOf(plain))} (declared: ${JSON.stringify(vocabularyOf(reporting))})`,
  );
  // #endregion zero-cost

  // The run itself: the vocabularies are declarations, so nothing below reads
  // them — the agent behaves exactly as it would without them.
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature', { respond: vocabularyRespond }),
    model: 'mock',
    maxIterations: 6,
    artifacts: inMemoryArtifacts(),
  })
    .system('You report on sales. Fetch the rows, then render them.')
    .tool(fetchRows)
    .tool(renderChart)
    .build();

  const answer = await agent.run({ message: input });
  return `${answer}\n\n${lines.join('\n')}\n\n${cloudConfigNote()}`;
}

/**
 * The cloud stores, CONFIG-ONLY — the swap is the whole change, and this
 * example never reaches a network or needs a credential.
 *
 * Both ship contract-shaped and tested, awaiting field use.
 */
function cloudConfigNote(): string {
  // Written as source rather than executed: constructing either one requires
  // its optional peer dependency, which this example deliberately does not
  // install.
  const config = [
    "  s3Artifacts({ bucket: 'my-agent-artifacts', prefix: 'artifacts', region: 'us-east-1' })",
    "  gcsArtifacts({ bucket: 'my-agent-artifacts', prefix: 'artifacts', projectId: 'my-project' })",
  ].join('\n');
  // Feature detection is how a consumer asks for the optional streaming leg —
  // the in-memory store answers honestly that it cannot.
  const memory: ArtifactStore = inMemoryArtifacts();
  return (
    `the same five verbs, in somebody else's bucket:\n${config}\n` +
    `  streaming is feature-detected, never assumed — ` +
    `canStreamArtifacts(inMemoryArtifacts()) = ${canStreamArtifacts(memory)}`
  );
}

/** The scripted "model": runs the two declared steps, then answers. */
function vocabularyRespond(req: LLMRequest): Partial<LLMResponse> {
  const toolResults = req.messages.filter((m) => m.role === 'tool');
  if (toolResults.length === 0) {
    return { content: '', toolCalls: [{ id: 'c1', name: 'fetch_rows', args: {} }] };
  }
  if (toolResults.length === 1) {
    return { content: '', toolCalls: [{ id: 'c2', name: 'render_chart', args: {} }] };
  }
  return { content: 'Q3 sales charted: north 41, south 37.' };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
