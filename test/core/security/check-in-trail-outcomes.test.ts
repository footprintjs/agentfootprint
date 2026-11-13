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
 * committed tool message (`LLMMessage.outcome`, stripped before any provider
 * sees it) and `core/checkin.ts` · `buildTrail` reads the field. A host's
 * notice standing in for a result (`LLMMessage.toolResultOrigin`) is not a
 * completed call either, so it reads not ok.
 * A tool's DECLARED status (an effects envelope with `status: 'failure'`)
 * counts; an undeclared `{"status":"failed"}` in a plain result is the tool's
 * words, which the trail does not parse.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  deny,
  allow,
  isCheckInPause,
  standardEvidenceAssembler,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMMessage, LLMRequest } from '../../../src/provider-contract/types.js';

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
  // What each request carried AT CALL TIME, as JSON: the request's messages
  // array is the library's live history, which goes on growing after the call.
  const wire: string[] = [];
  const agent = Agent.create({
    provider: mock({
      respond: (req: LLMRequest) => {
        wire.push(JSON.stringify(req.messages));
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
    // The second request carries the five tool results, four of them not
    // completed, so an unstripped marker would be on it.
    expect(wire[1]).toContain('connection refused');
    expect(wire[1]).not.toContain('"outcome"');
  });

  it("a host's notice in place of a result reads not ok", async () => {
    const notice = (id: string, origin: LLMMessage['toolResultOrigin']): LLMMessage => ({
      role: 'tool',
      toolCallId: id,
      toolName: 'lookup',
      content: 'The result of this call is not known.',
      toolResultOrigin: origin,
    });
    const history: LLMMessage[] = [
      { role: 'user', content: 'pay' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'n1', name: 'lookup', args: {} },
          { id: 'n2', name: 'lookup', args: {} },
          { id: 'n3', name: 'lookup', args: {} },
        ],
      },
      notice('n1', 'outcome-unknown'),
      notice('n2', 'input-cancelled'),
      { role: 'tool', toolCallId: 'n3', toolName: 'lookup', content: 'sunny' },
    ];
    const evidence = await standardEvidenceAssembler({
      tool: { name: 'wire_money', description: 'send money' },
      args: {},
      iteration: 2,
      history,
      scorer: () => [],
    });
    expect(evidence.trail?.toolCalls).toEqual([
      { name: 'lookup', ok: false }, // the host does not know whether it ran
      { name: 'lookup', ok: false }, // the person cancelled the input it waited on
      { name: 'lookup', ok: true }, // a plain result
    ]);
  });
});
