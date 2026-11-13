/**
 * The check-in trail reads each earlier call's outcome from the RECORD.
 *
 * A person approving a check-in sees `evidence.trail.toolCalls`: every call
 * the run already made, each with `ok`. That `ok` used to be read from the
 * first words of the tool message — four prose prefixes the library's own
 * refusals start with. So a tool that THREW (its history text is the bare
 * error message, "connection refused") showed as ok, and a tool that merely
 * RETURNED text starting "declined by human" showed as not ok.
 *
 * The dispatch knows how each call settled; it now writes that on the
 * committed tool message (`LLMMessage.toolOutcome`, stripped before any
 * provider sees it) and `core/checkin.ts` · `buildTrail` reads the field.
 * A tool's DECLARED status (an effects envelope with `status: 'failure'`)
 * counts; an undeclared `{"status":"failed"}` in a plain result is the tool's
 * words, which the trail does not parse.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, deny, allow, isCheckInPause } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

function tool(name: string, execute: () => unknown, extra: Record<string, unknown> = {}) {
  return defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: execute as never,
    ...extra,
  });
}

async function trailAndWire() {
  const wire: LLMRequest[] = [];
  const agent = Agent.create({
    provider: mock({
      respond: (req: LLMRequest) => {
        wire.push(req);
        return wire.length === 1
          ? {
              toolCalls: ['lookup', 'verify', 'plain', 'echo', 'blocked'].map((name, i) => ({
                id: `c${i}`,
                name,
                args: {},
              })),
            }
          : { toolCalls: [{ id: 'w1', name: 'wire_money', args: {} }] };
      },
    }),
    model: 'mock',
  })
    .system('S')
    .tool(
      tool('lookup', () => {
        throw new Error('connection refused');
      }),
    )
    .tool(tool('verify', () => ({ content: 'not verified', effects: [], status: 'failure' })))
    .tool(tool('plain', () => ({ status: 'failed' })))
    .tool(tool('echo', () => 'declined by human: tool-authored text'))
    .tool(tool('blocked', () => 'never runs'))
    .tool(tool('wire_money', () => 'sent', { checkIn: 'always' }))
    .toolMiddleware({
      name: 'no-blocked',
      onToolCall: (call) => (call.toolName === 'blocked' ? deny('not this one') : allow()),
    })
    .build();
  const out = await agent.run({ message: 'pay' });
  if (!isCheckInPause(out)) throw new Error('expected the check-in');
  return { trail: out.checkIn.evidence.trail, wire };
}

describe('the check-in trail', () => {
  it('reads ok from how each call settled, not from its first words', async () => {
    const { trail } = await trailAndWire();
    expect(trail?.toolCalls).toEqual([
      { name: 'lookup', ok: false }, // threw
      { name: 'verify', ok: false }, // declared status 'failure'
      { name: 'plain', ok: true }, // returned; an undeclared status is the tool's words
      { name: 'echo', ok: true }, // returned text that only LOOKS like a refusal
      { name: 'blocked', ok: false }, // refused by a middleware before it ran
    ]);
  });

  it('the outcome marker never reaches the provider', async () => {
    const { wire } = await trailAndWire();
    expect(JSON.stringify(wire[1]?.messages)).not.toContain('toolOutcome');
  });
});
