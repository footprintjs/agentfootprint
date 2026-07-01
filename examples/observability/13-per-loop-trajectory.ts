/**
 * 13 — Per-loop trajectory: slice a ReAct run into one frame PER iteration (proposal 005).
 *
 * The localizer (examples 05/10/11/12) reads a run as ONE flattened bag of context
 * sources. But a ReAct agent reasons in LOOPS — and a context bug usually lives in a
 * SPECIFIC loop (the iteration where the model picked the wrong tool, or read the
 * misleading fact). `assembleTrajectory` rebuilds that loop structure from the SAME
 * commit log — zero new capture:
 *
 *   findLoopHeads   → the first commit of each injection-engine entry (one per loop)
 *   bucketByAnchors → a TOTAL partition of the log into [head[k], head[k+1]) frames
 *   per frame       → its call-llm pointer, the text that step produced, and the LIVE
 *                     contextSources that fed it (findLastWriter + commitValueAt — the
 *                     PRIOR writer of each key the call-llm read, never its own write-back)
 *
 * This is the per-loop substrate the two-score localizer (L2), the recall scorer (L3),
 * and the backtracking debugger (L4) all read instead of a flattened bag.
 *
 * Works for BOTH chart shapes (this example runs both):
 *   - FLAT (default `reactMode: 'dynamic'`): frames bucketed over the run commit log.
 *   - GROUPED (`reactMode: 'dynamic-grouped'`): the LLM turn runs inside an sf-llm-call
 *     subflow; each loop is projected PER-SCOPE over its own inner commit log (retained
 *     per-iteration by footprintjs subflow-commit-visibility). Grouped frames carry
 *     `subflowScope`.
 * Standing caveat: contextSources show only sources re-committed to tracked state; context
 * the model retained internally is NOT here.
 *
 * Offline + deterministic: a scripted mock provider does two tool turns then a final
 * answer → three loops, no model required.
 *
 * Run:  npx tsx examples/observability/13-per-loop-trajectory.ts
 */
import { Agent, defineTool } from '../../src/index.js'
import { mock } from '../../src/llm-providers.js';
import { assembleTrajectory, type ContextBugArtifacts } from '../../src/observe';

export const meta = {
  id: '13',
  title: 'per-loop trajectory — one frame per ReAct iteration',
  description:
    'assembleTrajectory slices a flat-agent run into LoopFrames (one per iteration) from ' +
    'the SAME commit log — each carries its call-llm pointer, the text it produced, and the ' +
    'live contextSources (prior writer of every key it read). The per-loop substrate for L2/L3/L4.',
};

/** Build + run an agent (2 tool turns then a final answer → 3 ReAct loops) in the given mode. */
async function runAgent(reactMode: 'dynamic' | 'dynamic-grouped') {
  const lookup = defineTool({
    name: 'lookup',
    description: 'look a value up',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async () => 'looked up',
  });
  let turn = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: () => {
      turn++;
      if (turn <= 2)
        return {
          content: `loop ${turn}: I should look this up`,
          toolCalls: [{ id: `call-${turn}`, name: 'lookup', args: { q: 'policy' } }],
          usage: { input: 100, output: 20 },
          stopReason: 'tool_use',
        };
      return { content: 'Final answer: approved.', toolCalls: [], usage: { input: 120, output: 30 }, stopReason: 'end_turn' };
    },
  });
  const agent = Agent.create({ provider, model: 'mock', readTracking: 'full', reactMode })
    .system('You are a careful policy assistant.')
    .tool(lookup)
    .build();
  await agent.run({ message: 'Should this refund be approved?' });
  return agent.getSnapshot()!;
}

function printTrajectory(label: string, snapshot: unknown): void {
  // assembleTrajectory takes the localizer's OWN artifacts bag — pass the full snapshot
  // (grouped reads subflowResults, not just commitLog).
  const traj = assembleTrajectory({ snapshot } as ContextBugArtifacts);
  console.log(`\n══ ${label} — ${traj.frames.length} ReAct iterations (prelude: ${traj.prelude.length} commits) ══`);
  for (const frame of traj.frames) {
    const scope = frame.subflowScope ? `  [scope ${frame.subflowScope}]` : '';
    console.log(`── loop ${frame.loopIndex}  (call-llm: ${frame.llmCallId})${scope} ──`);
    console.log(`   produced: ${JSON.stringify(frame.intermediateText)?.slice(0, 70) ?? '(none)'}`);
    const fed = frame.contextSources.filter((s) => s.writerId !== undefined);
    console.log(`   fed by ${fed.length} live context sources (prior writers):`);
    for (const s of fed.slice(0, 4)) {
      const preview = String(s.value ?? '').replace(/\s+/g, ' ').slice(0, 36);
      console.log(`     • ${s.key.padEnd(22)} ← ${s.writerId}   "${preview}…"`);
    }
  }
}

async function main(): Promise<void> {
  // FLAT (default): call-llm is a parent-level stage; frames bucketed over the run commit log.
  printTrajectory('FLAT chart (reactMode: dynamic)', await runAgent('dynamic'));

  // GROUPED: the LLM turn runs inside sf-llm-call; each loop projected PER-SCOPE over its
  // own inner commit log — note the per-loop `subflowScope` and the distinct inner call-llm ids.
  printTrajectory('GROUPED chart (reactMode: dynamic-grouped)', await runAgent('dynamic-grouped'));

  console.log(
    '\nTakeaway: the bug-hunt starts at a LOOP, not a flat bag — for BOTH chart shapes. Each frame\n' +
      'says which context fed which iteration\'s decision, so L3 can score per-loop recall and L4 can\n' +
      'backtrack from the final answer to the loop that went wrong. Grouped frames carry subflowScope\n' +
      '(indices relative to that loop\'s own sf-llm-call commit log).',
  );
}

void main();
