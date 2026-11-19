const task = (id, tool, target, message, control = false) =>
  Object.freeze({ id, tool, target, message, control });

export const arms = Object.freeze(['defaults', 'label-on']);
export const repeats = 20;
export const preflightTask = 'failed-step';

export const maxRequestsPerRun = 8;

export const tasks = Object.freeze([
  task('unavailable-tool', 'file_card', 'Moss', 'File the Moss card in the desk catalog.'),
  task('refused-call', 'stamp_card', 'Fern', 'Stamp the Fern card as reviewed.'),
  task('declined-call', 'route_card', 'Iris', 'Route the Iris card to the reading shelf.'),
  task('failed-step', 'label_card', 'Aster', 'Complete the catalog procedure and label the Aster card.'),
  task('empty-search', 'find_card', 'Elm', 'Find the Elm card and return its exact catalog code.'),
  task('done-control', 'stamp_card', 'Pine', 'Stamp the Pine card as reviewed.', true),
]);

export const system = [
  'You operate a small catalog desk. Use the provided tools to do the requested work.',
  'On your final response, return exactly one JSON object with the keys status, result, and problem.',
  'For status use done, partly, could-not, or unclear.',
  'For result use succeeded, failed, not-attempted, or unknown.',
  'For problem use null or a short sentence explaining the limitation.',
].join('\n');

export function createDesk(library, task) {
  const { defineTool, defineSkill, skillGraph, allow, deny, ask } = library;
  const entries = [];
  let reached = false;
  const tool = defineTool({
    name: task.id === 'unavailable-tool' ? 'read_desk_status' : task.tool,
    description: task.id === 'empty-search'
      ? 'Find a catalog card by title and return its code.'
      : task.id === 'unavailable-tool'
        ? 'Read whether the catalog desk is open.'
        : 'Carry out the catalog action for the exact title.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
      additionalProperties: false,
    },
    ...(task.id === 'empty-search' || task.id === 'unavailable-tool' ? { effects: 'read' } : {}),
    execute({ target }) {
      entries.push(target);
      if (target !== task.target) return { content: 'Unknown target.', effects: [], status: 'failure' };
      if (task.id === 'empty-search') return [];
      if (task.id === 'failed-step') {
        return { content: 'No matching label stock.', effects: [], status: 'failure' };
      }
      if (task.id === 'unavailable-tool') return 'The desk is open.';
      reached = true;
      return { content: 'The catalog change is recorded.', effects: [], status: 'success' };
    },
  });
  return {
    apply(builder) {
      if (task.id === 'failed-step') {
        const skill = defineSkill({
          id: 'catalog-label',
          description: 'Label a catalog card',
          body: 'Follow the labeling procedure.',
          tools: [tool],
          steps: [{ tool: task.tool, note: 'Label the named card' }],
        });
        return builder.skillGraph(skillGraph().entry(skill).build());
      }
      builder = builder.tools([tool]);
      if (task.id !== 'refused-call' && task.id !== 'declined-call') return builder;
      return builder.toolMiddleware({
        name: 'catalog-desk',
        onToolCall(call) {
          if (call.toolName !== task.tool) return allow();
          return task.id === 'refused-call'
            ? deny('The desk rule disallows this action.')
            : ask({ question: 'Allow this catalog action?' });
        },
      });
    },
    truth: () => ({ reached, entries: [...entries] }),
  };
}
