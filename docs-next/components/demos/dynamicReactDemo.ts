/**
 * dynamicReactDemo — the SINGLE SOURCE for the "Try it live" embed on the
 * Dynamic ReAct docs page.
 *
 * The `demo` region below is BOTH:
 *   • what the reader SEES  — rendered verbatim via <CodeFile region="demo"> at
 *     build time (the docs build FAILS if this file or region goes missing), and
 *   • what actually RUNS    — `buildDynamicReactAgent()` is imported by the embed
 *     and traced live in the browser.
 *
 * One function, zero drift: the bytes on screen are provably the bytes that run.
 * It imports the `agentfootprint` PACKAGE (the same copy the lens observes) — never
 * the source tree — so there is exactly one library instance and the lens lights
 * the executed path with no translation.
 */

// #region demo
import {
  Agent,
  mock,
  defineTool,
  defineSteering,
  defineInstruction,
  defineSkill,
  defineFact,
} from 'agentfootprint';

/** Builds the Dynamic ReAct agent the docs trace live (mock LLM — no network). */
export function buildDynamicReactAgent() {
  // A tool that redacts PII before any refund goes out.
  const redactPii = defineTool({
    name: 'redact_pii',
    description: 'Redact personally-identifiable info (emails, phones).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    execute: ({ text }: { text: string }) =>
      text.replace(/[\w.-]+@[\w.-]+/g, '[EMAIL]').replace(/\d{3}-\d{4}/g, '[PHONE]'),
  });

  // Always-on safety policy — part of every system prompt.
  const safety = defineSteering({
    id: 'safety',
    prompt: 'Never expose raw PII (emails, phone numbers) in your final answer.',
  });

  // The star of Dynamic ReAct: an Instruction that activates ONLY on the
  // iteration AFTER redact_pii returned — on-tool-return context injection.
  const postPii = defineInstruction({
    id: 'post-pii',
    description: 'Brief reminder to use the redacted text, not the original.',
    activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
    prompt: 'Use the redacted text in your reply. Do not paraphrase the original.',
  });

  // A skill the LLM loads on demand via read_skill('billing'). Reading it unlocks
  // process_refund AND injects the billing playbook for the next iteration.
  const billing = defineSkill({
    id: 'billing',
    description: 'Read for refunds / charges. Unlocks process_refund.',
    body: 'When refunding: redact PII first using redact_pii, THEN call process_refund.',
    tools: [
      defineTool({
        name: 'process_refund',
        description: 'Issue a refund. Args: { amount: number }.',
        inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
        execute: ({ amount }: { amount: number }) => `Refund of $${amount} issued.`,
      }),
    ],
  });

  // An iteration-counter nudge — only kicks in once the turn runs long.
  const focusReminder = defineInstruction({
    id: 'focus',
    activeWhen: (ctx) => ctx.iteration >= 3,
    prompt: 'You have been working on this turn for several iterations. Wrap up the response now.',
  });

  // A plain always-present fact.
  const userProfile = defineFact({ id: 'user-profile', data: 'User: Alice Chen. Plan: Pro.' });

  // Scripted mock LLM — stands in for a real provider so this runs offline in your
  // browser. `thinkingMs` adds a little latency so each iteration is visible as the
  // run traces. Swap `mock(...)` for `anthropic(...)` / `openai(...)` for a real run.
  let iter = 0;
  const provider = mock({
    thinkingMs: 420,
    respond: () => {
      iter += 1;
      switch (iter) {
        case 1:
          return {
            content: 'Loading billing skill.',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'billing' } }],
            usage: { input: 30, output: 8 },
          };
        case 2:
          return {
            content: 'Redacting PII first.',
            toolCalls: [{ id: 'c2', name: 'redact_pii', args: { text: 'alice@example.com refund $42' } }],
            usage: { input: 60, output: 8 },
          };
        case 3:
          return {
            content: 'Issuing refund.',
            toolCalls: [{ id: 'c3', name: 'process_refund', args: { amount: 42 } }],
            usage: { input: 90, output: 6 },
          };
        default:
          return {
            content: 'Done. Refund of $42 issued for [EMAIL]. You should see it in 3-5 business days.',
            toolCalls: [],
            usage: { input: 100, output: 22 },
          };
      }
    },
  });

  return Agent.create({ provider, model: 'mock', maxIterations: 6 })
    .system('You are a customer support assistant.')
    .tool(redactPii)
    .steering(safety)
    .skill(billing)
    .instruction(postPii)
    .instruction(focusReminder)
    .fact(userProfile)
    .build();
}
// #endregion demo
