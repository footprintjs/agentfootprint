import type { MemoryDefinition } from '../../../../memory/define.types.js';

export interface MemoryPort {
  readonly memoryList: MemoryDefinition[];
  assertSummarizerIsNotTheAgentItself(billing: MemoryDefinition['billing'], label: string): void;
}

export function registerMemory<TReceiver extends MemoryPort>(
  self: TReceiver,
  definition: MemoryDefinition,
  original: object,
): object {
  if (self.memoryList.some((m) => m.id === definition.id)) {
    throw new Error(
      `Agent.memory(): duplicate id '${definition.id}' — each memory needs a unique id ` +
        'to keep its scope key (`memoryInjection_${id}`) collision-free.',
    );
  }
  // A memory that calls a model on your behalf — today that is the
  // `summarize` strategy — is held to the same separate-instance rule as
  // `.compaction()`. `defineMemory` cannot make this check: it has never
  // heard of an agent. It declares the billing, this reads it (9.14.0).
  self.assertSummarizerIsNotTheAgentItself(definition.billing, `Agent.memory('${definition.id}')`);
  self.memoryList.push(definition);
  return original;
}
