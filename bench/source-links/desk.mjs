import { createDesk } from '../honest-report/tasks.mjs';

export const lookupTool = 'read_catalog_source';

export function createPilotDesk(library, task, arm) {
  const bindings = [];
  const loaded = new Set();
  const desk = createDesk(library, {
    id: 'source-links', tool: lookupTool, targets: task.lookups,
  }, {
    readTarget(source, { toolCallId }) {
      if (loaded.has(source)) return 'This source was already read. Use the earlier result.';
      const next = task.lookups[loaded.size];
      if (source !== next) return `Read ${next} before ${source}.`;
      loaded.add(source);
      const { handle, content } = task.results[source];
      if (arm === 'ordinary') return content;
      const wireContent = `Source handle: ${handle}\n${content}`;
      bindings.push({ handle, toolCallId, source, content, wireContent });
      return wireContent;
    },
  });
  return { apply: desk.apply, bindings };
}

// Each slot must identify one local occurrence, including its exact observed text.
export function visibleResults(messages, bindings) {
  const visible = [];
  const gaps = [];
  for (const binding of bindings) {
    const slots = messages.flatMap((message, index) =>
      message.role === 'tool' && message.toolCallId === binding.toolCallId ? [{ message, index }] : []);
    const sharedId = bindings.filter(({ toolCallId }) => toolCallId === binding.toolCallId).length !== 1;
    const slot = slots[0];
    if (!sharedId && slots.length === 1 && slot.message.content === binding.wireContent) {
      visible.push({ ...binding, wireContent: slot.message.content, messageIndex: slot.index });
    } else {
      const reason = sharedId || slots.length > 1 ? 'ambiguous'
        : slots.length === 0 ? 'absent' : 'content-mismatch';
      gaps.push({ handle: binding.handle, toolCallId: binding.toolCallId, reason });
    }
  }
  return { visible, gaps };
}
