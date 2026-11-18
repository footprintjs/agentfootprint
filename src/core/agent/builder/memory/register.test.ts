import { describe, expect, it } from 'vitest';
import { defineMemory } from '../../../../memory/define.js';
import {
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type MemoryDefinition,
} from '../../../../memory/define.types.js';
import { InMemoryStore } from '../../../../memory/store/InMemoryStore.js';
import { registerMemory, type MemoryPort } from './register.js';

const memory = () =>
  defineMemory({
    id: 'conversation',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 4 },
    store: new InMemoryStore(),
  });

describe('the builder memory declaration', () => {
  it('checks the live summarizer guard before registration and retains the definition', () => {
    const definition = memory();
    const receiver: MemoryPort = {
      memoryList: [],
      assertSummarizerIsNotTheAgentItself(billing, label) {
        expect(this).toBe(receiver);
        expect(this.memoryList).toEqual([]);
        expect(billing).toBe(definition.billing);
        expect(label).toBe("Agent.memory('conversation')");
      },
    };
    expect(registerMemory(receiver, definition, receiver)).toBe(receiver);
    expect(receiver.memoryList[0]).toBe(definition);
  });

  it('refuses an existing id before consulting billing or invoking a validation hook', () => {
    const definition = memory();
    const receiver: MemoryPort = {
      memoryList: [definition],
      assertSummarizerIsNotTheAgentItself() {
        throw new Error('duplicate must be checked first');
      },
    };
    const duplicate: MemoryDefinition = {
      ...definition,
      get billing(): never {
        throw new Error('duplicate billing must not be read');
      },
    };
    expect(() => registerMemory(receiver, duplicate, receiver)).toThrow(
      /duplicate id 'conversation'/,
    );
    expect(receiver.memoryList).toEqual([definition]);
  });

  it('does not retain a memory whose summarizer pairing is refused', () => {
    const receiver: MemoryPort = {
      memoryList: [],
      assertSummarizerIsNotTheAgentItself() {
        throw new Error('same summarizer pairing');
      },
    };
    expect(() => registerMemory(receiver, memory(), receiver)).toThrow('same summarizer pairing');
    expect(receiver.memoryList).toEqual([]);
  });
});
