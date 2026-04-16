/**
 * Sample 26: Custom Routing — Escalate to a Specialist Without a Swarm
 *
 * `.route({ branches })` lets you inject your own routing paths ahead of the
 * default `tool-calls | final` routing. Each branch is a predicate over the
 * agent's scope; the first match wins and the branch's runner takes over.
 *
 * This is the middle ground between a plain Agent (too rigid) and a full Swarm
 * (adds an orchestrator LLM). Use it when you want a deterministic safety valve
 * based on what the main agent said, not another LLM call.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ RouteResponse (decider)                     │
 *   │                                              │
 *   │   escalate     → humanReviewAgent            │  ← user branch
 *   │   pii-leak     → redactionAgent              │  ← user branch
 *   │   tool-calls   → ExecuteTools (default)      │
 *   │   final        → Finalize (default)          │
 *   └─────────────────────────────────────────────┘
 */
import { Agent, mock } from 'agentfootprint';
import type { RunnerLike } from 'agentfootprint';

// A minimal inline runner — any RunnerLike works: Agent, LLMCall, RAG, Swarm,
// or a bespoke object with `.run(input) → { content, messages }`.
const humanReviewAgent: RunnerLike = {
  async run(input: string) {
    return {
      content: `[ROUTED TO HUMAN REVIEW] Ticket queued for review: "${input}"`,
      messages: [],
    };
  },
};

const redactionAgent: RunnerLike = {
  async run(_input: string) {
    return {
      content: '[REDACTED] We removed the sensitive data and would follow up separately.',
      messages: [],
    };
  },
};

export async function run(input: string) {
  const agent = Agent.create({
    provider: mock([
      // The main agent produces a response containing a keyword the router matches on.
      { content: '[ESCALATE] This user is frustrated, routing to human.' },
    ]),
  })
    .system('You are a support agent. Use [ESCALATE] if the user needs human help.')
    .route({
      branches: [
        {
          id: 'escalate',
          when: (s) =>
            typeof s.parsedResponse?.content === 'string' &&
            s.parsedResponse.content.includes('[ESCALATE]'),
          runner: humanReviewAgent,
        },
        {
          id: 'pii-leak',
          when: (s) =>
            typeof s.parsedResponse?.content === 'string' &&
            /\b\d{3}-\d{2}-\d{4}\b/.test(s.parsedResponse.content),
          runner: redactionAgent,
        },
      ],
    })
    .build();

  const result = await agent.run(input);
  return { content: result.content };
}

if (process.argv[1] === import.meta.filename) {
  run("I've been waiting 2 weeks with no response, this is unacceptable!").then(console.log);
}
