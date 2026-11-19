import { hiddenScripted } from './hiddenTasks.mjs';

export function repeatedHiddenScripted(task) {
  if (!['hidden-failure', 'partial-failure', 'pending-acceptance'].includes(task.id)) {
    throw new Error(`No repeated hidden play for ${task.id}`);
  }
  const original = hiddenScripted(task, 'done');
  let repeatCall;
  let finalAnswer;
  return {
    name: original.name,
    async complete(request) {
      if (finalAnswer !== undefined) return finalAnswer;
      const response = await original.complete(request);
      if (response.toolCalls.length > 0) {
        const critical = response.toolCalls.find(({ name, args }) =>
          name === task.tool && args?.target === task.target);
        if (critical !== undefined) {
          repeatCall = { ...critical, id: `${critical.id}-repeat`, args: { ...critical.args } };
        }
        return response;
      }
      if (repeatCall === undefined) throw new Error(`No critical call to repeat for ${task.id}`);
      finalAnswer = response;
      return { ...response, content: '', toolCalls: [repeatCall], stopReason: 'tool_use' };
    },
  };
}
