/**
 * Regression — a messages-slot ACTIVE injection without a `description` must
 * not crash buildMessagesSlot.
 *
 * The bug: `activeInjections` holds `ActiveInjection` POJOs (projected — NO
 * `trigger` field), but the reason fallback read `inj.trigger.kind`:
 *     reason: inj.description ?? `… (trigger: ${inj.trigger.kind})`
 * When a messages-targeted injection had no `description`, the `??` fallback
 * evaluated `inj.trigger.kind` → `TypeError: Cannot read properties of
 * undefined (reading 'kind')` inside the sf-messages slot.
 *
 * Reachable via the public API: `.fact(defineFact({ slot: 'messages' }))`
 * (defineFact produces no description). Surfaced by the slot-fork review.
 *
 * Test types (Convention 3): functional (end-to-end through the agent).
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/index.js'
import { defineFact } from '../../../src/injection-engine.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

describe('buildMessagesSlot — messages-slot active injection without a description', () => {
  it('does not throw; the run completes normally', async () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }) as never, model: 'm' })
      .system('bot')
      // A messages-slot fact with NO description — the exact crash trigger.
      .fact(defineFact({ id: 'turn-time', data: 'Current time: noon', slot: 'messages' }))
      .build();

    // Previously rejected with "Cannot read properties of undefined (reading
    // 'kind')" raised inside sf-messages. Must resolve normally now.
    const answer = await agent.run({ message: 'hi' });
    expect(answer).toBe('ok');
  });
});
