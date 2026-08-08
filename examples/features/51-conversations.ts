/**
 * 51 — A conversation, and the three things that are not one.
 *
 * `agent.run()` is ONE turn. It seeds its history from the message you pass
 * and nothing else, so a second `run()` starts a new conversation and the
 * model — honestly — tells your user it has not spoken to them before.
 *
 * That used to be the whole story, and it was a trap: the mistake was easy to
 * make, the code looked right, nothing threw, and the only symptom was an
 * agent that kept forgetting. This example runs the trap and the fix side by
 * side, and PRINTS what the model actually received each time, because the
 * only convincing evidence here is the wire.
 *
 *   1. `run()` twice          → two conversations   (the trap)
 *   2. `followUp(message)`    → one conversation    (this instance's own)
 *   3. `run({ continueFrom })`→ one conversation    (from a store, anywhere)
 *
 * ── The three things that LOOK like conversation memory and are not ─────────
 *
 *   • `identity: { conversationId }` — a NAMESPACE key. It scopes memory,
 *     RAG, permissions and credentials. Passing the same one to two runs does
 *     not join them; this example proves it on the wire.
 *   • a registered `.memory()` — real, and different in kind: prior turns come
 *     back as RECALL in the system prompt (`<memory role=…>` blocks), not as
 *     message turns. Useful, and not the same as the conversation.
 *   • `.selfExplain()` — reads the previous run's TRACE. The conversation
 *     carries what was SAID; the trace carries what was DONE. Example 49 uses
 *     both together.
 *
 * ── Two refusals you can rely on ────────────────────────────────────────────
 * Both replace behavior that used to succeed while being wrong, so both are
 * demonstrated rather than described: a second run while one is in flight, and
 * a new message while a person still owes the agent an answer.
 *
 * Run: npx tsx examples/features/51-conversations.ts
 */

import {
  Agent,
  defineTool,
  PendingQuestionError,
  RunInFlightError,
  type AgentRunCheckpoint,
  type LLMProvider,
  type LLMRequest,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { pauseHere } from '../../src/core/pause.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/51-conversations',
  title: 'Conversations — run() is one turn, followUp() is the next one',
  group: 'features',
  description:
    'agent.run() is a single turn and starts a new conversation every time; agent.followUp(message) and run({ message, continueFrom }) are the doors that continue one. The example prints the messages the provider actually received for all three, shows that identity.conversationId is a namespace key rather than a session, and demonstrates the two refusals that replaced silent corruption.',
  defaultInput: 'Book me a table for two on Friday.',
  providerSlots: ['default'],
  tags: ['feature', 'conversation', 'multi-turn', 'checkpoint', 'sessions'],
};

/** A provider that answers plausibly AND records what it was sent. */
function transcriptProvider(): { provider: LLMProvider; seen: LLMRequest[] } {
  const seen: LLMRequest[] = [];
  return {
    provider: mock({
      chunkDelayMs: 0,
      respond: (req: LLMRequest) => {
        seen.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const said = req.messages.filter((m) => m.role === 'user').map((m) => String(m.content));
        // The whole point: the model can only use what it was SENT.
        const knowsTheTable = said.some((t) => /table/i.test(t));
        const asksToChange = /make it|change|move/i.test(said.at(-1) ?? '');
        if (asksToChange && !knowsTheTable) {
          return "I don't have any earlier booking from you — this is your first message. What would you like to book?";
        }
        if (asksToChange) return 'Updated your Friday booking to three people.';
        return 'Booked: a table for two on Friday at 7pm.';
      },
    }),
    seen,
  };
}

/** Print the user turns the model was shown for request #i. */
function showWire(label: string, seen: LLMRequest[], index: number): void {
  const turns = (seen[index]?.messages ?? []).map(
    (m) => `      ${m.role.padEnd(9)} ${String(m.content).slice(0, 62)}`,
  );
  console.log(`  ${label}`);
  console.log(turns.join('\n') || '      (nothing)');
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const makeAgent = (): { agent: Agent; seen: LLMRequest[] } => {
    const wire = transcriptProvider();
    const agent = Agent.create({
      // `id` is what lets a STORED conversation refuse the wrong agent later.
      // Optional, and only agents that both chose one are ever compared.
      id: 'bookings',
      provider: provider ?? wire.provider,
      model: 'mock',
    })
      .system('You take restaurant bookings. Be brief.')
      .build();
    return { agent, seen: wire.seen };
  };

  // ── 1. THE TRAP — two run() calls are two conversations ───────────────
  console.log('── 1. run() twice — a new conversation each time ────────');
  {
    const { agent, seen } = makeAgent();
    await agent.run({ message: input });
    const second = await agent.run({ message: 'Make it three.' });
    showWire('turn 2 saw:', seen, 1);
    console.log(`  agent: ${String(second)}\n`);
  }

  // ── 1b. …and the same conversationId does NOT join them ──────────────
  console.log('── 1b. same identity.conversationId — still two ─────────');
  {
    const { agent, seen } = makeAgent();
    const identity = { conversationId: 'diner-42' };
    await agent.run({ message: input, identity });
    await agent.run({ message: 'Make it three.', identity });
    showWire('turn 2 saw:', seen, 1);
    console.log('  (identity scopes memory + permissions. It is not a session.)\n');
  }

  // ── 2. THE DOOR — followUp() continues this agent's conversation ─────
  console.log('── 2. followUp() — one conversation ─────────────────────');
  let answer = '';
  {
    const { agent, seen } = makeAgent();
    await agent.run({ message: input });
    answer = String(await agent.followUp('Make it three.'));
    showWire('turn 2 saw:', seen, 1);
    console.log(`  agent: ${answer}\n`);
  }

  // ── 3. THE SAME DOOR, ACROSS A RESTART ───────────────────────────────
  //
  // `checkpoint()` hands back the conversation as plain JSON. Store it under
  // your session id, hand it to ANY instance later, and the turn continues —
  // carrying the identity it started with, so the memory it writes lands
  // where the earlier turns can read it.
  console.log('── 3. run({ continueFrom }) — across a restart ──────────');
  {
    const first = makeAgent();
    await first.agent.run({ message: input, identity: { conversationId: 'diner-42' } });
    const stored: AgentRunCheckpoint = JSON.parse(JSON.stringify(first.agent.checkpoint()));
    console.log(
      `  stored: ${stored.history.length} messages · identity ${JSON.stringify(
        stored.identity,
      )} · agent ${JSON.stringify(stored.agent)}`,
    );

    // …a deploy later, a different process, a fresh Agent object.
    const next = makeAgent();
    await next.agent.run({ message: 'Make it three.', continueFrom: stored });
    showWire('turn 2 saw:', next.seen, 0);
    console.log('');
  }

  // ── 4. THE REFUSALS ──────────────────────────────────────────────────
  console.log('── 4. what is refused, and why ──────────────────────────');
  {
    const { agent } = makeAgent();
    const inFlight = agent.run({ message: input });
    try {
      await agent.run({ message: 'and another thing' });
    } catch (err) {
      if (!(err instanceof RunInFlightError)) throw err;
      console.log('  two runs at once → RunInFlightError');
      console.log(
        '    (both used to succeed; the instance state afterwards belonged to whichever',
      );
      console.log('     finished last, so checkpoint() could hand back the other run.)');
    }
    await inFlight;
  }
  {
    const askForApproval = defineTool({
      name: 'confirm_booking',
      description: 'Ask the diner to confirm before booking.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        pauseHere({ question: 'Confirm the table for three on Friday?' });
        return 'unreachable';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'confirm_booking', args: {} }] },
          { content: 'Confirmed.' },
        ],
      }),
      model: 'mock',
    })
      .system('You take bookings.')
      .tool(askForApproval)
      .build();

    await agent.run({ message: input });
    try {
      await agent.run({ message: 'actually, cancel everything' });
    } catch (err) {
      if (!(err instanceof PendingQuestionError)) throw err;
      console.log(`  message during a pending question → PendingQuestionError (${err.toolName})`);
      console.log('    answer it with resume(checkpoint, decision), or say you are dropping it:');
      const dropped = agent.abandonPause();
      console.log(`    abandonPause() → dropped ${JSON.stringify(dropped?.question)}`);
    }
  }

  console.log(
    '\nWhat to reach for:\n' +
      '  one turn, no history        → agent.run({ message })\n' +
      '  the next turn, same process → agent.followUp(message)\n' +
      '  the next turn, from a store → agent.run({ message, continueFrom })\n' +
      '  a whole server of sessions  → standingAgent({ agent, sessions, host })\n' +
      '  recall rather than replay   → .memory(defineMemory({ … })) + identity\n' +
      '  what the agent DID, not said → .selfExplain() (example 49)',
  );

  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
