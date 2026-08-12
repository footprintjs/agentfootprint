/**
 * 52 — Tool sessions: summarize prose, compute data.
 *
 * A tool that hands the model 40,000 rows has not given it data. It has spent
 * the context window. The failure that motivated this feature is real and
 * measured: a production request of 879,073 tokens, almost all of it one tool
 * result pasted into the prompt. Since 9.6.0 that at least fails BY NAME
 * (`ContextWindowExceededError`) instead of as an opaque vendor 400 — this is
 * the other half of the answer: not failing better, but not needing to.
 *
 * With a code runner, the model writes the aggregation, the RUNNER holds the
 * rows, and what comes back is the number.
 *
 * ── The part that is actually new (9.7.0) ──────────────────────────────────
 * A code interpreter is Start → Execute ×N → Stop. Before this release a
 * `Tool` had nowhere to hold the middle of that. `ToolExecutionContext` carried
 * no run or session identity, and nothing ever said "this is over" — so a tool
 * either paid session start-up on EVERY call, or held the session in a
 * module-level map. In a standing agent serving many people from one process,
 * that second option hands person B person A's files.
 *
 * Now `ctx` carries `runId` / `sessionId` / `identity`, and `ctx.onTeardown`
 * registers cleanup for exactly the key the tool just derived. This example
 * prints all three parts:
 *
 *   1. THE PAYOFF     — three calls in one turn, ONE interpreter start.
 *   2. THE ISOLATION  — two people inside ONE sessionId get TWO sandboxes.
 *   3. THE END-SIGNAL — the four events a session leaves behind, and who fires
 *                       which: the run for `scope: 'run'`, and YOU for
 *                       `scope: 'session'`.
 *
 * ── Which runner ────────────────────────────────────────────────────────────
 * `localCodeRunner()` is a CHILD PROCESS on this machine. That is isolation,
 * not a sandbox: separate process and heap, kill-on-timeout, an environment
 * allowlist — and NO filesystem jail, NO network jail, no CPU or memory limit.
 * Fine for a dev loop. For model-written code from untrusted users, swap in
 * `agentCoreCodeRunner({ region, identifier })` — a real managed sandbox behind
 * the same port. The tool code below does not change.
 *
 * Run:  npx tsx examples/features/52-run-code.ts
 */

import {
  Agent,
  codeRunnerTool,
  type CodeRunner,
  type CodeSession,
  type LLMProvider,
} from '../../src/index.js';
import { localCodeRunner, mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/52-run-code',
  title: 'Tool sessions — summarize prose, compute data',
  group: 'features',
  description:
    'A code-interpreter tool that holds ONE session per isolation key. Shows the payoff (three calls in one turn share one interpreter start), the isolation (two principals inside one sessionId get two sandboxes, because sessionId is caller data and never keys a session on its own), and the end-signal (ctx.onTeardown fires at run end; a session-scoped one waits for agent.closeToolSessions from your composition root). localCodeRunner is process isolation and says so; agentCoreCodeRunner is the production swap behind the same port.',
  defaultInput: 'How many orders shipped late last quarter?',
  providerSlots: ['default'],
  tags: ['feature', 'tools', 'code-interpreter', 'sessions', 'teardown', 'context-window'],
};

// ── A runner that COUNTS, so the example can prove the payoff ──────────────
//
// It wraps the real `localCodeRunner`, so the code below genuinely runs in a
// child process; the counters are only so the output can show you what
// happened rather than assert it in prose.
function countingRunner(inner: CodeRunner): {
  runner: CodeRunner;
  starts: string[];
  stops: string[];
} {
  const starts: string[] = [];
  const stops: string[] = [];
  return {
    starts,
    stops,
    runner: {
      id: inner.id,
      async start(req): Promise<CodeSession> {
        starts.push(req.key);
        const session = await inner.start(req);
        return {
          id: session.id,
          execute: (exec) => session.execute(exec),
          stop: async () => {
            stops.push(req.key);
            await session.stop();
          },
        };
      },
    },
  };
}

/** A model that writes three snippets, then answers from what they printed. */
function scriptedAnalyst(): LLMProvider {
  return mock({
    replies: [
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'run_code',
            args: {
              // Turn 1 builds the dataset INSIDE the interpreter. None of it
              // travels back through the conversation — this is the whole
              // point of the doctrine.
              code:
                'const orders = Array.from({length: 40000}, (_, i) => ' +
                '({ id: i, lateDays: i % 7 }));\n' +
                'globalThis.orders = orders;\n' +
                'console.log(`loaded ${orders.length} orders`);',
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c2',
            name: 'run_code',
            // Turn 2 reads a variable turn 1 created. That only works because
            // the SESSION was reused — a fresh process would not have it.
            args: { code: 'console.log(globalThis.orders.filter(o => o.lateDays > 3).length);' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c3',
            name: 'run_code',
            args: {
              code: 'const pct = globalThis.orders.filter(o => o.lateDays > 3).length / globalThis.orders.length;\nconsole.log((pct * 100).toFixed(1) + "%");',
            },
          },
        ],
      },
      { content: '17143 of 40000 orders shipped late — 42.9%.' },
    ],
  });
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // ── 1. THE PAYOFF ────────────────────────────────────────────────────────
  console.log('1. THE PAYOFF — three calls, one interpreter\n');

  const counted = countingRunner(localCodeRunner({ maxOutputChars: 2_000 }));
  const events: string[] = [];

  const analyst = Agent.create({
    provider: provider ?? scriptedAnalyst(),
    model: 'mock',
    maxIterations: 6,
  })
    .system('You analyse data by writing code. Never ask for raw rows.')
    // `scope: 'run'` (the default) — one interpreter per turn. The session is
    // opened on the first call and released when the turn ends; nothing you
    // write has to remember to close it.
    .tool(codeRunnerTool({ runner: counted.runner, language: 'javascript' }))
    .build();

  analyst.on('agentfootprint.tools.*', (e) => {
    if (!e.type.includes('session_')) return;
    const payload = e.payload as { keyHash?: string; calls?: number; reason?: string };
    events.push(
      `${e.type.replace('agentfootprint.tools.', '')}` +
        ` key=${payload.keyHash}` +
        (payload.calls ? ` calls=${payload.calls}` : '') +
        (payload.reason ? ` reason=${payload.reason}` : '') +
        ` @${e.meta.runtimeStageId}`,
    );
  });

  const answer = await analyst.run({ message: input });

  console.log(`  interpreter starts : ${counted.starts.length}   (three tool calls)`);
  console.log(`  interpreter stops  : ${counted.stops.length}`);
  console.log(`  answer             : ${String(answer)}`);
  console.log(
    '\n  40,000 rows existed for the whole turn and NONE of them entered the\n' +
      '  conversation. That is "summarize prose, compute data".\n',
  );

  // ── 2. THE ISOLATION ─────────────────────────────────────────────────────
  console.log('2. THE ISOLATION — one sessionId, two people, two sandboxes\n');

  const shared = countingRunner(localCodeRunner());
  const twoPeople = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'a', name: 'run_code', args: { code: 'console.log(1)' } }] },
        { content: 'ok' },
        { toolCalls: [{ id: 'b', name: 'run_code', args: { code: 'console.log(2)' } }] },
        { content: 'ok' },
      ],
    }),
    model: 'mock',
    maxIterations: 4,
  })
    // `scope: 'session'` — the interpreter survives BETWEEN turns of one
    // conversation, so variables and files persist for the person it belongs to.
    .tool(codeRunnerTool({ runner: shared.runner, scope: 'session', language: 'javascript' }))
    .build();

  // The SAME `sessionId`. It is caller data — anyone who can reach a host can
  // put any string there, including someone else's — so it never keys a live
  // session on its own. The key composes tenant + principal + session.
  await twoPeople.run(
    { message: 'mine', identity: { tenant: 'acme', principal: 'ada', conversationId: 'c' } },
    { sessionId: 'sess-1' },
  );
  await twoPeople.run(
    { message: 'mine too', identity: { tenant: 'acme', principal: 'bob', conversationId: 'c' } },
    { sessionId: 'sess-1' },
  );

  for (const key of shared.starts) console.log(`  sandbox opened for : ${key}`);
  console.log(
    '\n  Two keys, two sandboxes. Keyed on sessionId alone, Bob would have\n' +
      "  inherited Ada's files, environment and half-run state.\n",
  );

  // ── 3. THE END-SIGNAL ────────────────────────────────────────────────────
  console.log('3. THE END-SIGNAL — who closes a session, and when\n');

  console.log(`  still open after both turns : ${shared.starts.length - shared.stops.length}`);
  // THE ONE LINE a composition root owns. Nothing in the library can know when
  // a request/reply session is over — a HostRequest carries a sessionId and no
  // end, and AWS itself does not tell you (an idle timeout is the reality). On
  // the conversation door this is `conversation.onClose(...)`; see
  // examples/deploy/echo-conversation.ts.
  const closed = await twoPeople.closeToolSessions({ sessionId: 'sess-1' });
  console.log(`  closeToolSessions()         : closed ${closed}`);
  console.log(
    '\n  Never calling it is survivable, not silent: sessions idle out on the\n' +
      "  tier's lazy sweep, a bounded live count evicts the coldest, and\n" +
      '  agent.shutdown() takes whatever is left — including under\n' +
      '  shutdown({ stop: false }), because a sandbox is not borrowed.\n',
  );

  console.log('  The four events the first turn left behind:');
  for (const line of events) console.log(`    ${line}`);
  console.log(
    '\n  `key=` is a DIGEST, never the key: the key composes tenant, principal\n' +
      '  and sessionId, and publishing it would put a user identifier into every\n' +
      "  exporter's payload.\n" +
      '\n  Look at where each one came FROM. A start and a reuse happen inside\n' +
      '  tool.execute, so they carry the real stage (`tool-calls#N`). The close\n' +
      '  fires after the last stage committed and has no stage to inherit, so it\n' +
      '  wears a STATED pseudo-stage (`tool-teardown#0`) — and its meta still\n' +
      '  carries the runId, so it joins the run that opened the session.\n',
  );

  console.log(
    'What to reach for:\n' +
      '  a dev loop, trusted input        → localCodeRunner()  (isolation, NOT a sandbox)\n' +
      '  model-written code, real users   → agentCoreCodeRunner({ region, identifier })\n' +
      '  one interpreter per turn         → codeRunnerTool({ runner })\n' +
      "  one per conversation             → codeRunnerTool({ runner, scope: 'session' })\n" +
      '                                     + agent.closeToolSessions({ sessionId })\n' +
      '  a human gate on the code         → codeRunnerTool({ runner, checkIn: (a) => risky(a.code) })\n' +
      '                                     (a pause does NOT tear the session down)',
  );

  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
