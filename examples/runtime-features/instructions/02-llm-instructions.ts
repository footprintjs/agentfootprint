/**
 * Tool-level instructions — co-located guidance that lands in the LLM's
 * recency window, next to the tool result where the model pays the most
 * attention.
 *
 * Three tiers: inject (text), followUp (suggested next tool call), and
 * a safety tier that never truncates and is always injected last.
 */

import {
  Agent,
  mock,
  defineTool,
  quickBind,
  type InstructedToolDefinition,
} from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli';

export const meta: ExampleMeta = {
  id: 'runtime-features/instructions/02-llm-instructions',
  title: 'Tool-level instructions (LLM guidance + follow-ups)',
  group: 'runtime-features',
  description: 'Co-locate LLM guidance with tools; inject into the recency window.',
  defaultInput: 'Evaluate a loan for Jane Doe, credit score 580, $25,000',
  providerSlots: ['default'],
  tags: ['instructions', 'tools', 'recency-window'],
};

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
  handler: async ({
    applicantName,
    creditScore,
    loanAmount,
  }: {
    applicantName: string;
    creditScore: number;
    loanAmount: number;
  }) => {
    if (creditScore >= 700 && loanAmount <= 50000) {
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
        reason: creditScore < 700 ? 'Credit score below threshold' : 'Loan amount too high',
        traceId: `tr_${Date.now()}`,
        ssn: '***-**-1234',
      }),
    };
  },
  instructions: [
    {
      id: 'denial-empathy',
      description: 'Be empathetic when loan is denied',
      when: (ctx: any) => (ctx.content as any)?.status === 'denied',
      inject:
        'The loan application was denied. Be empathetic. Do NOT promise the decision can be reversed. Suggest the applicant can try again after improving their credit score.',
      followUp: quickBind('get_denial_trace', 'traceId', {
        description: 'Retrieve the detailed denial reasoning and decision factors',
        condition: 'User asks why their loan was denied',
      }),
      priority: 1,
    },
    {
      id: 'approval-congrats',
      description: 'Congratulate on approval',
      when: (ctx: any) => (ctx.content as any)?.status === 'approved',
      inject: 'The loan was approved! Congratulate the applicant and mention rate and term.',
      priority: 1,
    },
    {
      id: 'pii-safety',
      description: 'Prevent PII leakage',
      when: (ctx: any) => !!(ctx.content as any)?.ssn,
      inject: 'Result contains PII (SSN). Do NOT repeat the SSN to the user.',
      safety: true,
    },
  ],
} as unknown as InstructedToolDefinition) as any;

const denialTraceTool = defineTool({
  id: 'get_denial_trace',
  description: 'Retrieve detailed denial reasoning for a loan application',
  inputSchema: { type: 'object', properties: { traceId: { type: 'string' } } },
  handler: async ({ traceId }) => ({
    content: JSON.stringify({
      traceId,
      factors: [
        { name: 'Credit Score', value: 580, threshold: 700, passed: false },
        { name: 'Debt-to-Income', value: 0.45, threshold: 0.43, passed: false },
      ],
    }),
  }),
});

const defaultMock = (): LLMProvider =>
  mock([
    {
      content: 'Let me evaluate this loan application.',
      toolCalls: [
        {
          id: 'tc-1',
          name: 'evaluate_loan',
          arguments: { applicantName: 'Jane Doe', creditScore: 580, loanAmount: 25000 },
        },
      ],
    },
    {
      content:
        "I'm sorry, the loan application was denied due to a credit score below threshold. You can improve your chances by building credit. Would you like the detailed reasoning?",
    },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const agent = Agent.create({ provider: provider ?? defaultMock(), name: 'loan-agent' })
    .tool(evaluateLoanTool)
    .tool(denialTraceTool)
    .build();

  const result = await agent.run(input);

  const toolMessages = result.messages.filter((m: any) => m.role === 'tool');
  const toolContent = toolMessages[0]?.content as string;

  return {
    agentResponse: result.content,
    instructionsInjected: toolContent?.includes('[INSTRUCTION]') ?? false,
    followUpInjected: toolContent?.includes('[AVAILABLE ACTION]') ?? false,
    messageCount: result.messages.length,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
