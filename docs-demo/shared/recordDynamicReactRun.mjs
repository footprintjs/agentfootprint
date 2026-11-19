import { deepStrictEqual, ok } from 'node:assert/strict';
import { dynamicReactInput } from './dynamicReactDemo.ts';

// Both the current-library check and the published-cohort generator use the
// same assertions. Export only the evidence the static guide needs.
export async function recordDynamicReactRun(agent) {
  const toolStarts = new Map();
  const tools = [];
  const evaluations = [];
  const refundAvailable = [];
  const slotsByIteration = new Map();
  const reminderEvents = [];
  const completedToolsAndReminder = [];
  const enteredTools = [];
  let iteration;

  agent.on('agentfootprint.context.evaluated', ({ payload }) => {
    iteration = payload.iteration;
    evaluations.push({ iteration, activeIds: payload.activeIds });
  });
  agent.on('agentfootprint.context.slot_composed', ({ payload }) => {
    const slots = slotsByIteration.get(payload.iteration) ?? [];
    slots.push(payload.slot);
    slotsByIteration.set(payload.iteration, slots);
  });
  agent.on('agentfootprint.context.injected', ({ payload }) => {
    if (payload.sourceId === 'post-pii') {
      reminderEvents.push({ iteration, slot: payload.slot });
      completedToolsAndReminder.push('post-pii');
    }
  });
  agent.on('agentfootprint.stream.llm_start', ({ payload }) => {
    if (payload.tools?.some(({ name }) => name === 'process_refund')) {
      refundAvailable.push(payload.iteration);
    }
  });
  agent.on('agentfootprint.stream.tool_start', ({ payload }) => {
    toolStarts.set(payload.toolCallId, { iteration, name: payload.toolName });
  });
  agent.on('agentfootprint.stream.tool_end', ({ payload }) => {
    const start = toolStarts.get(payload.toolCallId);
    tools.push({ ...start, result: payload.result });
    if (payload.entered && !payload.error) enteredTools.push(start?.name);
    completedToolsAndReminder.push(start?.name);
  });

  const result = await agent.run({ message: dynamicReactInput });

  // The answer is scripted. The tool results and context events are independent
  // evidence that redaction, skill activation and per-iteration composition ran.
  deepStrictEqual(result, 'Done. Refund of $42 issued for [EMAIL]. You should see it in 3-5 business days.');
  deepStrictEqual(tools, [
    { iteration: 1, name: 'read_skill', result: "Skill 'billing' activated for the next iteration." },
    { iteration: 2, name: 'redact_pii', result: 'My account is [EMAIL] — please refund $42' },
    { iteration: 3, name: 'process_refund', result: 'Refund of $42 issued.' },
  ]);
  deepStrictEqual(enteredTools, ['read_skill', 'redact_pii', 'process_refund']);
  deepStrictEqual(completedToolsAndReminder, ['read_skill', 'redact_pii', 'post-pii', 'process_refund']);
  deepStrictEqual(evaluations, [
    { iteration: 1, activeIds: ['safety', 'user-profile'] },
    { iteration: 2, activeIds: ['safety', 'billing', 'user-profile'] },
    { iteration: 3, activeIds: ['safety', 'billing', 'post-pii', 'focus', 'user-profile'] },
    { iteration: 4, activeIds: ['safety', 'billing', 'focus', 'user-profile'] },
  ]);
  deepStrictEqual(reminderEvents, [{ iteration: 3, slot: 'system-prompt' }]);
  deepStrictEqual(refundAvailable, [2, 3, 4], 'The model only sees process_refund after skill activation.');
  deepStrictEqual([...slotsByIteration].map(([step, slots]) => [step, slots.sort()]),
    [1, 2, 3, 4].map((step) => [step, ['messages', 'system-prompt', 'tools']]));
  ok(agent.getLastSnapshot()?.executionTree, 'The Dynamic ReAct run must keep its execution tree.');

  return { result, tools, reminder: reminderEvents[0] };
}
