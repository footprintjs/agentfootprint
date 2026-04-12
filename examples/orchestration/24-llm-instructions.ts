/**
 * Sample 24: LLM Instructions — Behavioral Guidance + Follow-Up Bindings
 *
 * A loan evaluation agent with co-located instructions on the tool:
 *   - When denied: be empathetic, offer follow-up to get denial trace
 *   - When approved: congratulate, offer follow-up to get terms
 *   - PII safety: never repeat SSN (safety instruction, always last)
 *
 * The instructions land in the LLM's recency window — right next to
 * the tool result, where the model pays the most attention.
 *
 * No API key required — uses mock().
 */
import {
  Agent,
  mock,
  defineTool,
  quickBind,
  type InstructedToolDefinition,
} from 'agentfootprint';

// ── Loan evaluation tool with instructions ─────────────────────

const evaluateLoanTool = defineTool({
  id: 'evaluate_loan',
  description: 'Evaluate a loan application and return approval/denial decision',
  inputSchema: {
    type: 'object',
    properties: {
      applicantName: { type: 'string' },
      creditScore: { type: 'number' },
      loanAmount: { type: 'number' },
    },
  },
  handler: async ({ applicantName, creditScore, loanAmount }) => {
    // Simulate loan evaluation
    const score = creditScore as number;
    const amount = loanAmount as number;

    if (score >= 700 && amount <= 50000) {
      return {
        content: JSON.stringify({
          status: 'approved',
          applicantName,
          rate: '5.2%',
          term: '30 years',
          traceId: `tr_${Date.now()}`,
        }),
      };
    }
    return {
      content: JSON.stringify({
        status: 'denied',
        applicantName,
        reason: score < 700 ? 'Credit score below threshold' : 'Loan amount too high',
        traceId: `tr_${Date.now()}`,
        ssn: '***-**-1234', // PII in result
      }),
    };
  },

  // ── Instructions: co-located with the tool ───────────────────
  instructions: [
    {
      id: 'denial-empathy',
      description: 'Guide LLM to be empathetic when loan is denied',
      when: (ctx) => (ctx.content as any)?.status === 'denied',
      inject: 'The loan application was denied. Be empathetic and understanding. '
        + 'Do NOT promise the decision can be reversed. '
        + 'Suggest the applicant can try again after improving their credit score.',
      followUp: quickBind('get_denial_trace', 'traceId', {
        description: 'Retrieve the detailed denial reasoning and decision factors',
        condition: 'User asks why their loan was denied or wants more details',
      }),
      priority: 1,
    },
    {
      id: 'approval-congrats',
      description: 'Guide LLM to congratulate on approval',
      when: (ctx) => (ctx.content as any)?.status === 'approved',
      inject: 'The loan was approved! Congratulate the applicant. '
        + 'Mention the interest rate and term from the result.',
      priority: 1,
    },
    {
      id: 'pii-safety',
      description: 'Prevent PII leakage from loan results',
      when: (ctx) => !!(ctx.content as any)?.ssn,
      inject: 'Result contains PII (SSN). Do NOT repeat the SSN to the user. '
        + 'Refer to it only as "on file" if the user asks.',
      safety: true, // Never truncated, always injected LAST (highest attention)
    },
  ],
} as InstructedToolDefinition) as any;

// ── Denial trace tool (follow-up target) ───────────────────────

const denialTraceTool = defineTool({
  id: 'get_denial_trace',
  description: 'Retrieve detailed denial reasoning for a loan application',
  inputSchema: {
    type: 'object',
    properties: { traceId: { type: 'string' } },
  },
  handler: async ({ traceId }) => ({
    content: JSON.stringify({
      traceId,
      factors: [
        { name: 'Credit Score', value: 580, threshold: 700, passed: false },
        { name: 'Debt-to-Income', value: 0.45, threshold: 0.43, passed: false },
        { name: 'Employment', value: '2 years', threshold: '1 year', passed: true },
      ],
    }),
  }),
});

// ── Build and run ──────────────────────────────────────────────

export async function run(input: string) {
  // Mock: LLM calls evaluate_loan, then responds
  const provider = mock([
    {
      content: 'Let me evaluate this loan application.',
      toolCalls: [{
        id: 'tc-1',
        name: 'evaluate_loan',
        arguments: { applicantName: 'Jane Doe', creditScore: 580, loanAmount: 25000 },
      }],
    },
    {
      content: 'I\'m sorry, but the loan application for Jane Doe was denied due to a credit score '
        + 'below our threshold. I understand this is disappointing. You can improve your chances '
        + 'by working on building your credit score. Would you like to see the detailed reasoning?',
    },
  ]);

  const agent = Agent.create({ provider, name: 'loan-agent' })
    .tool(evaluateLoanTool)
    .tool(denialTraceTool)
    .build();

  const result = await agent.run(input);

  // ── Show what the LLM saw in the recency window ────────────

  const toolMessages = result.messages.filter((m: any) => m.role === 'tool');
  const toolContent = toolMessages[0]?.content as string;

  // Check that instructions were injected
  const hasInstruction = toolContent?.includes('[INSTRUCTION]') ?? false;
  const hasFollowUp = toolContent?.includes('[AVAILABLE ACTION]') ?? false;

  return {
    agentResponse: result.content,
    toolResultWithInstructions: toolContent,
    instructionsInjected: hasInstruction,
    followUpInjected: hasFollowUp,
    messageCount: result.messages.length,
  };
}

if (process.argv[1] === import.meta.filename) {
  run('Evaluate a loan for Jane Doe, credit score 580, $25,000').then((r) => {
    console.log('=== Agent Response ===');
    console.log(r.agentResponse);
    console.log();
    console.log('=== What the LLM Saw (tool result + injected instructions) ===');
    console.log(r.toolResultWithInstructions);
    console.log();
    console.log(`Instructions injected: ${r.instructionsInjected}`);
    console.log(`Follow-up injected: ${r.followUpInjected}`);
  });
}
