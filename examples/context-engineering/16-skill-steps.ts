/**
 * 16 — Steps as data: the skill procedure the framework walks (9.18.0).
 *
 * `defineSkill({ steps })` declares the procedure as DATA — an ordered list
 * of `{ tool, note }` pairs — and the framework owns sequence and scope at
 * the protocol level: while the skill holds the tenure, the tools slot
 * offers ONLY the current step's tool (its description led by
 * `[Step k of n — <note>]`) plus `skip_step`. An unoffered schema is never
 * sent, so the model cannot call step 5's tool from step 3 — no refusal
 * machinery, no gate. The model keeps the judgment INSIDE each step:
 *
 *   • run the tool — the result gains "Step k done. Now on step k+1…";
 *   • skip it with `skip_step(reason)` — the reason goes on the record
 *     (`skill.step_skipped`), and the declared `onSkip` policy decides
 *     whether the pointer moves or holds;
 *   • use an escape hatch — `read_skill` and every other skill's tools
 *     stay offered throughout;
 *   • or stop and say why — a premature final gets ONE teaching nudge
 *     (`steps_unfinished { action: 'nudged' }`), and a second stop is
 *     honored (`'accepted'`). A declared order, never a cage.
 *
 * A step whose tool asks a human (`askHuman`) pauses the run mid-procedure;
 * the pointer rides the checkpoint, and the person's answer advances the
 * step on resume — human-in-the-loop as an ordinary step.
 *
 * Every move lands on the typed event stream (`skill.step_advanced` /
 * `step_skipped` / `steps_unfinished`) — this example prints them, because
 * the record IS the feature.
 */

import { Agent, defineTool, isPaused, askHuman, type LLMProvider } from '../../src/index.js';
import { defineSkill } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/16-skill-steps',
  title: 'Steps as data — the skill procedure the framework walks',
  group: 'context-engineering',
  description:
    'Declare a 6-step refund procedure on a skill; the tools slot offers one ' +
    'step at a time (escape hatches intact), skip_step puts a decline on the ' +
    'record, an askHuman step pauses and advances on resume, and every move ' +
    'is a typed skill.step_* event.',
  defaultInput: 'Please refund order #4021 — I was charged twice',
  providerSlots: ['default'],
  tags: ['context-engineering', 'skills', 'steps', 'hitl', 'showcase'],
};

/** One tiny deterministic tool per step — the procedure is the point. */
const t = (name: string, result: string) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name.replace(/_/g, ' ')}.`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => result,
  });

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const approveRefund = defineTool<Record<string, never>, string>({
    name: 'approve_refund',
    description: 'Ask a person to approve the refund before money moves.',
    inputSchema: { type: 'object', properties: {} },
    // A step that needs a human is just a tool that asks one: the run pauses
    // mid-procedure, the pointer rides the checkpoint, and the answer
    // advances the step on resume.
    execute: () => askHuman({ question: 'Refund $42.10 on order #4021 — approve?' }),
  });

  // #region define-steps
  const refundProcedure = defineSkill({
    id: 'refund',
    description: 'Handles refunds end to end, by declared procedure.',
    body: 'Follow the refund procedure. Every step says why it exists.',
    tools: [
      t('find_order', 'order #4021: $42.10, card ending 4242'),
      t('check_history', 'one charge on 2026-08-01, one duplicate on 2026-08-02'),
      t('verify_identity', 'identity verified'),
      approveRefund,
      t('issue_refund', 'refund of $42.10 issued'),
      t('file_receipt', 'receipt R-991 filed'),
    ] as never,
    steps: [
      { tool: 'find_order', note: 'find the order before touching money' },
      { tool: 'check_history', note: 'confirm the duplicate charge' },
      { tool: 'verify_identity', note: 'verify the caller owns the card' },
      { tool: 'approve_refund', note: 'a person approves before money moves' },
      { tool: 'issue_refund', note: 'refund the duplicate charge only' },
      { tool: 'file_receipt', note: 'file the receipt for audit' },
    ],
    // 'advance' (the default, spelled out): a recorded skip moves on.
    onSkip: 'advance',
  });
  // #endregion define-steps

  const record: string[] = [];
  const agent = Agent.create({
    provider: provider ?? scriptedProvider(),
    model: 'mock',
    maxIterations: 10,
  })
    .system('You are a support agent. Handle the refund.')
    .injection(refundProcedure)
    .watch({
      id: 'step-record',
      onEmit: (e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        if (e.name === 'agentfootprint.skill.step_advanced') {
          const s = p.step as { index: number; total: number; tool: string };
          record.push(
            `step_advanced   ${s.index}/${s.total} ${s.tool}${
              p.completed ? ' — procedure complete' : ''
            }`,
          );
        }
        if (e.name === 'agentfootprint.skill.step_skipped') {
          const s = p.step as { index: number; total: number; tool: string };
          record.push(
            `step_skipped    ${s.index}/${s.total} ${s.tool} — "${String(
              p.reason,
            )}" (policy: ${String(p.policy)})`,
          );
        }
        if (e.name === 'agentfootprint.skill.steps_unfinished') {
          record.push(
            `steps_unfinished action=${String(p.action)} remaining=${
              (p.remaining as unknown[]).length
            }`,
          );
        }
      },
    })
    .build();

  // #region hitl-step
  // The run pauses at step 4 — approve_refund asked a human.
  const outcome = await agent.run({ message: input });
  let answer: string;
  if (isPaused(outcome)) {
    record.push('(paused at the approval step — a person answers…)');
    // The person's answer IS the step's result; the step advances on resume.
    const resumed = await agent.resume(outcome.checkpoint, 'approved — refund the duplicate');
    answer = isPaused(resumed) ? '(paused again — not expected in this script)' : resumed;
  } else {
    answer = outcome;
  }
  // #endregion hitl-step

  return [`answer: ${answer}`, '', 'the recorded procedure:', ...record.map((r) => `  ${r}`)].join(
    '\n',
  );
}

/**
 * Deterministic offline provider so the example runs with zero setup. The
 * script activates the skill, runs steps 1–2, SKIPS step 3 with a reason
 * (the caller already verified), pauses at the human approval, then
 * finishes 5–6 and answers.
 */
function scriptedProvider(): LLMProvider {
  const script = [
    { name: 'read_skill', args: { id: 'refund' } },
    { name: 'find_order', args: {} },
    { name: 'check_history', args: {} },
    { name: 'skip_step', args: { reason: 'caller already passed identity verification' } },
    { name: 'approve_refund', args: {} },
    { name: 'issue_refund', args: {} },
    { name: 'file_receipt', args: {} },
  ];
  let i = 0;
  return mock({
    respond: () => {
      const next = script[i];
      if (!next) {
        return {
          content: 'Refunded the duplicate $42.10 charge on order #4021; receipt R-991 filed.',
          toolCalls: [],
          stopReason: 'stop' as const,
        };
      }
      i += 1;
      return {
        content: '',
        toolCalls: [{ id: `t${i}`, name: next.name, args: next.args }],
        stopReason: 'tool_use' as const,
      };
    },
  });
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
