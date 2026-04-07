/**
 * Regression test: array proxy silent reads in agentfootprint context.
 *
 * Original bug: accessing `memory_preparedMessages` (an array) in CommitMemory
 * produced 5 "Read memory_preparedMessages" entries in the narrative because
 * every internal array operation (.length, iteration, etc.) fired onRead.
 *
 * Fix: array proxy's getCurrent() uses getValueSilent() — only the initial
 * property access fires one tracked onRead.
 */

import { describe, it, expect } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { AgentLoopState } from '../../src/scope/types';
import type { Message } from '../../src/types/messages';

const user = (text: string): Message => ({ role: 'user', content: text });
const assistant = (text: string): Message => ({ role: 'assistant', content: text });

describe('array proxy narrative — agentfootprint regression', () => {
  it('reading memory_preparedMessages array fires exactly 1 Read in narrative', async () => {
    // Simulate the CommitMemory pattern: read messages, storedHistory, and
    // preparedMessages arrays, then compare lengths and slice.
    const chart = flowChart<AgentLoopState>(
      'Seed',
      (scope) => {
        scope.messages = [user('hello'), assistant('hi'), user('how?')];
        scope.memory_storedHistory = [user('hello'), assistant('hi'), user('how?')];
        scope.memory_preparedMessages = [user('hello'), assistant('hi'), user('how?')];
        scope.memory_shouldCommit = true;
      },
      'seed',
    )
      .addFunction(
        'CommitMemory',
        (scope) => {
          // This is the exact pattern from commitMemory.ts that triggered the bug:
          const messages = scope.messages ?? [];
          const storedHistory = scope.memory_storedHistory ?? [];
          const prepared = scope.memory_preparedMessages ?? [];

          // These array operations (.length, indexing, .slice) were each
          // firing onRead before the fix:
          if (storedHistory.length > 0 && prepared.length < storedHistory.length) {
            const systemInjected =
              messages.length > 0 &&
              messages[0].role === 'system' &&
              (prepared.length === 0 || prepared[0].role !== 'system');
            const preparedEnd = systemInjected ? prepared.length + 1 : prepared.length;
            const _newLLMMessages = messages.slice(preparedEnd);
          }
        },
        'commit-memory',
      )
      .build();

    const executor = new FlowChartExecutor(chart);
    executor.enableNarrative();
    await executor.run({});

    const entries = executor.getNarrativeEntries();
    const narrativeLines = executor.getNarrative();

    // Count "Read memory_preparedMessages" entries in the CommitMemory stage
    const preparedReads = entries.filter(
      (e) => e.stageName === 'CommitMemory' && e.text.includes('Read memory_preparedMessages'),
    );

    // Before fix: this was 5. After fix: exactly 1.
    expect(preparedReads).toHaveLength(1);

    // Same check for storedHistory and messages
    const storedReads = entries.filter(
      (e) => e.stageName === 'CommitMemory' && e.text.includes('Read memory_storedHistory'),
    );
    expect(storedReads).toHaveLength(1);

    const messagesReads = entries.filter(
      (e) => e.stageName === 'CommitMemory' && e.text.includes('Read messages'),
    );
    expect(messagesReads).toHaveLength(1);

    // Verify narrative is concise — 1 Write (Seed) + 1 Read (CommitMemory)
    const commitNarrative = narrativeLines.filter((l) => l.includes('memory_preparedMessages'));
    expect(commitNarrative).toHaveLength(2); // Write in Seed + Read in CommitMemory
    expect(commitNarrative.filter((l) => l.includes('Read'))).toHaveLength(1);
    expect(commitNarrative.filter((l) => l.includes('Write'))).toHaveLength(1);
  });

  it('array .map() + .filter() + .length chain = 1 Read per key', async () => {
    const chart = flowChart<AgentLoopState>(
      'Seed',
      (scope) => {
        scope.messages = [user('hello'), assistant('hi'), user('tools?'), assistant('sure')];
      },
      'seed',
    )
      .addFunction(
        'ProcessMessages',
        (scope) => {
          // Multiple chained array operations on a single key
          const msgs = scope.messages;
          const _len = msgs.length;
          const _userMsgs = msgs.filter((m) => m.role === 'user');
          const _contents = msgs.map((m) => m.content);
          const _first = msgs[0];
          const _last = msgs[msgs.length - 1];
        },
        'process',
      )
      .build();

    const executor = new FlowChartExecutor(chart);
    executor.enableNarrative();
    await executor.run({});

    const entries = executor.getNarrativeEntries();
    const messageReads = entries.filter(
      (e) => e.stageName === 'ProcessMessages' && e.text.includes('Read messages'),
    );

    // All array operations are silent — only 1 tracked read
    expect(messageReads).toHaveLength(1);
  });
});
