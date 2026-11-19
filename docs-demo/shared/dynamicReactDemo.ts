export const dynamicReactInput = 'My account is alice@example.com — please refund $42';

// #region demo
type DynamicReactApi = {
  Agent: typeof import('agentfootprint').Agent;
  defineTool: typeof import('agentfootprint').defineTool;
  mock: typeof import('agentfootprint/providers').mock;
  defineSteering: typeof import('agentfootprint/context').defineSteering;
  defineInstruction: typeof import('agentfootprint/context').defineInstruction;
  defineSkill: typeof import('agentfootprint/context').defineSkill;
  defineFact: typeof import('agentfootprint/context').defineFact;
};

type DynamicReactOptions = {
  thinkingMs?: number;
  structureRecorders?: Parameters<DynamicReactApi['Agent']['create']>[0]['structureRecorders'];
};

/** The current-library check and the published demo each supply their own SDK. */
export function buildDynamicReactAgent(
  { Agent, defineTool, mock, defineSteering, defineInstruction, defineSkill, defineFact }: DynamicReactApi,
  { thinkingMs = 420, structureRecorders }: DynamicReactOptions = {},
) {
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

  // Reading this skill makes process_refund available and injects the billing
  // playbook for the next iteration.
  const billing = defineSkill({
    id: 'billing',
    description: 'Read for refunds / charges. Unlocks process_refund.',
    body: 'When refunding: redact PII first using redact_pii, THEN call process_refund.',
    autoActivate: 'currentSkill',
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

  // The mock passes your message to the redactor. The refund amount and the
  // final answer are scripted. thinkingMs makes the browser trace easier to follow.
  let iter = 0;
  const provider = mock({
    thinkingMs,
    respond: ({ messages }) => {
      iter += 1;
      switch (iter) {
        case 1:
          return {
            content: 'Loading billing skill.',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'billing' } }],
            usage: { input: 30, output: 8 },
          };
        case 2: {
          const text = messages.find(({ role }) => role === 'user')?.content ?? '';
          return {
            content: 'Redacting PII first.',
            toolCalls: [{ id: 'c2', name: 'redact_pii', args: { text } }],
            usage: { input: 60, output: 8 },
          };
        }
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

  return Agent.create({ provider, model: 'mock', maxIterations: 6, reactMode: 'dynamic-grouped', structureRecorders })
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
