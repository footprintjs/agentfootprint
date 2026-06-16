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
 * Honest scope (printed below): v1 segments the FLAT agent chart. The grouped chart
 * (sf-llm-call) keeps slot keys in the subflow scope — detected and degraded with an
 * honesty flag, never silently mis-bucketed. Standing caveat: contextSources show only
 * sources re-committed to tracked state; context the model retained internally is NOT here.
 *
 * Offline + deterministic: a scripted mock provider does two tool turns then a final
 * answer → three loops, no model required.
 *
 * Run:  npx tsx examples/observability/13-per-loop-trajectory.ts
 */
import { Agent, defineTool, mock } from '../../src/index.js';
import { assembleTrajectory, type ContextBugArtifacts } from '../../src/observe';

export const meta = {
  id: '13',
  title: 'per-loop trajectory — one frame per ReAct iteration',
  description:
    'assembleTrajectory slices a flat-agent run into LoopFrames (one per iteration) from ' +
    'the SAME commit log — each carries its call-llm pointer, the text it produced, and the ' +
    'live contextSources (prior writer of every key it read). The per-loop substrate for L2/L3/L4.',
};

async function main(): Promise<void> {
  // A lookup tool the agent calls twice before answering → 3 ReAct loops.
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
      return {
        content: 'Final answer: approved.',
        toolCalls: [],
        usage: { input: 120, output: 30 },
        stopReason: 'end_turn',
      };
    },
  });

  const agent = Agent.create({ provider, model: 'mock', readTracking: 'full' })
    .system('You are a careful policy assistant.')
    .tool(lookup)
    .build();

  await agent.run({ message: 'Should this refund be approved?' });

  // The localizer's own artifacts bag — assembleTrajectory takes the SAME input.
  const artifacts = { snapshot: agent.getSnapshot()! } as ContextBugArtifacts;
  const traj = assembleTrajectory(artifacts);

  console.log(`Per-loop trajectory — ${traj.frames.length} ReAct iterations\n`);
  console.log(`prelude (run setup, before the first loop): ${traj.prelude.length} commits\n`);

  for (const frame of traj.frames) {
    console.log(`── loop ${frame.loopIndex}  (call-llm: ${frame.llmCallId}) ──`);
    console.log(`   produced: ${JSON.stringify(frame.intermediateText)?.slice(0, 80) ?? '(none)'}`);
    const fed = frame.contextSources.filter((s) => s.writerId !== undefined);
    console.log(`   fed by ${fed.length} live context sources (prior writers):`);
    for (const s of fed.slice(0, 4)) {
      const preview = String(s.value ?? '').replace(/\s+/g, ' ').slice(0, 40);
      console.log(`     • ${s.key.padEnd(22)} ← ${s.writerId}   "${preview}…"`);
    }
    if (frame.untrackedReadsPresent)
      console.log(`   ⚠ this step also read untracked sources (${frame.incompleteSources?.join(', ')})`);
    console.log();
  }

  if (traj.honestyFlags.length > 0)
    for (const f of traj.honestyFlags) console.log(`⚠ honesty flag [${f.flag}]: ${f.note}`);

  console.log(
    'Takeaway: the bug-hunt now starts at a LOOP, not a flat bag. Each frame says exactly\n' +
      'which context fed which iteration\'s decision — so L3 can score per-loop recall and L4\n' +
      'can backtrack from the final answer to the loop that went wrong.',
  );
}

void main();
