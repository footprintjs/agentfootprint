/**
 * The wire seam — the composed frame and the serialized body must agree,
 * and only the body can say what the body carried (T7b's shape).
 *
 * The recorded defect: the internal frame said a subsystem's tools were
 * removed; the adapter still serialized four schemas. Every pre-wire check
 * read a clean frame. This suite pins the whole rail: the manifest is read
 * back from the FINAL request body (adapter side), compared against the
 * exact request handed to the adapter (callLLM side), and a divergence
 * files ONE typed finding per run.
 *
 * Test types (Convention 3): unit (extractor, check + fences) / contract
 * (the anthropic adapter states the manifest off its real params object;
 * honest absence stays absent) / functional+regression (the live loop:
 * healthy echo silent, drifting adapter files exactly once).
 */

import { describe, expect, it } from 'vitest';
import { toolManifestOf } from '../../src/adapters/llm/wireManifest.js';
import { wireViolationsOf } from '../../src/integrity/invariant-violation/wire.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMResponse } from '../../src/adapters/types.js';

// ---------------------------------------------------------------------------
// The extractor
// ---------------------------------------------------------------------------

describe('unit: the manifest is read off the final body', () => {
  it('no tools field is a STATED zero, not an unknown', () => {
    expect(toolManifestOf(undefined)).toEqual({ toolNames: [] });
  });

  it('names come off the serialized array, non-strings dropped', () => {
    expect(
      toolManifestOf([{ name: 'a' }, { name: 'b' }, { name: 42 as unknown as string }]),
    ).toEqual({ toolNames: ['a', 'b'] });
  });
});

// ---------------------------------------------------------------------------
// The check and its fences
// ---------------------------------------------------------------------------

const composed = (...names: string[]) => ({ names, provenance: 'callLLM' });
const onWire = (...names: string[]) => ({ names, provenance: 'anthropic' });

describe('unit: wireViolationsOf', () => {
  it('agreement — whatever the order — is silence the caller files as checked-pass', () => {
    expect(wireViolationsOf(composed('a', 'b'), onWire('b', 'a'), 3)).toEqual([]);
  });

  it('a name on the wire the frame never composed is the recorded bug, one finding', () => {
    const found = wireViolationsOf(composed('a'), onWire('a', 't1', 't2'), 3);
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.kind).toBe('invariant-violation');
    expect(f.seam).toBe('wire');
    expect(f.subjects).toEqual([
      { kind: 'tool', id: 't1' },
      { kind: 'tool', id: 't2' },
    ]);
    expect(f.message).toContain('crossed the wire');
    expect(f.message).toContain('t1, t2');
  });

  it('a composed name that never crossed is the other direction, its own finding', () => {
    const found = wireViolationsOf(composed('a', 'gone'), onWire('a'), 3);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('never crossed');
    expect(found[0]!.subjects).toEqual([{ kind: 'tool', id: 'gone' }]);
  });

  it('both directions at once are two findings, never blended', () => {
    expect(wireViolationsOf(composed('kept', 'gone'), onWire('kept', 'ghost'), 3)).toHaveLength(2);
  });

  it('no manifest stated = incomparable — silence, never a guess', () => {
    expect(wireViolationsOf(composed('a'), undefined, 3)).toEqual([]);
  });

  it('an EMPTY manifest is a stated zero and compares normally', () => {
    const found = wireViolationsOf(composed('a'), onWire(), 3);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('never crossed');
  });
});

// ---------------------------------------------------------------------------
// The anthropic adapter states the manifest off its real params object
// ---------------------------------------------------------------------------

function fakeClient() {
  return {
    messages: {
      create() {
        return Promise.resolve({
          id: 'msg_1',
          model: 'claude-sonnet-4-5-20250929',
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
      stream() {
        throw new Error('not used in this suite');
      },
    },
  } as never;
}

describe('contract: the anthropic adapter states what its body carried', () => {
  it('the manifest names the serialized tools', async () => {
    const provider = anthropic({ _client: fakeClient() });
    const response = await provider.complete({
      model: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'get_zone_info', description: 'z', inputSchema: { type: 'object' } },
        { name: 'screen_open', description: 's', inputSchema: { type: 'object' } },
      ],
    });
    expect(response.wireManifest).toEqual({ toolNames: ['get_zone_info', 'screen_open'] });
  });

  it('a tool-less request states the zero', async () => {
    const provider = anthropic({ _client: fakeClient() });
    const response = await provider.complete({
      model: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.wireManifest).toEqual({ toolNames: [] });
  });
});

// ---------------------------------------------------------------------------
// Through the live loop — healthy echo silent; a drifting adapter files ONCE
// ---------------------------------------------------------------------------

const screen = () =>
  defineTool({
    name: 'screen_open',
    description: 's',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  });

const call = (id: string): Partial<LLMResponse> => ({
  content: '',
  toolCalls: [{ id, name: 'screen_open', args: {} }],
  stopReason: 'tool_use',
});
const done: Partial<LLMResponse> = { content: 'done', toolCalls: [], stopReason: 'stop' };

describe('functional: the wire check through the real loop', () => {
  it('the healthy adapter (mock echoes its request) files nothing', async () => {
    const events: unknown[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call('c1'), done] }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .tool(screen())
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => events.push(e.payload));
    await agent.run('go');
    expect(events).toEqual([]);
  });

  it('a drifting adapter — schemas on the wire the frame never composed — files ONE finding across the run', async () => {
    // Every reply states a manifest with a retained ghost schema, standing in
    // for the recorded adapter bug. Three calls re-detect; identity dedup
    // files once.
    const drift = { toolNames: ['screen_open', 'ghost_tool'] };
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          { ...call('c1'), wireManifest: drift },
          { ...call('c2'), wireManifest: drift },
          { ...done, wireManifest: drift },
        ],
      }),
      model: 'mock',
      maxIterations: 6,
    })
      .system('s')
      .tool(screen())
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });
    await agent.run('go');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'invariant-violation', seam: 'wire' });
    expect(String(events[0]!.message)).toContain('ghost_tool');
  });
});
