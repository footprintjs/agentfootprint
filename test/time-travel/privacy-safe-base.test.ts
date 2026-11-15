/** A safe fold base must not turn privacy-withheld request fields into known empty values. */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import { Agent, defineTool, receiptAt, servedAt } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';
import { nativeRetainsSafeBase } from '../redaction/nativeFoldBase.js';

const SYSTEM = 'PRIVATE-SYSTEM-FIXTURE-941';
const TOOL = 'offered_lookup_fixture';
const policy = () => conversationRedaction({ keys: ['dynamicToolSchemas', 'toolSchemas'] });

async function recorded(
  options: { redact?: RedactionPolicy; system?: string; tool?: string | false } = {},
) {
  const wire: Array<{ system: string; tools: string[] }> = [];
  const delegate = mock({ chunkDelayMs: 0, replies: [{ content: 'Public answer.' }] });
  const provider: LLMProvider = {
    name: delegate.name,
    complete: async (request: LLMRequest) => {
      wire.push({
        system: request.systemPrompt ?? '',
        tools: request.tools?.map((tool) => tool.name) ?? [],
      });
      return delegate.complete(request);
    },
  };
  const builder = Agent.create({
    provider,
    model: 'mock',
    reactMode: 'dynamic',
    ...(options.redact === undefined ? {} : { redact: options.redact }),
  }).system(options.system ?? SYSTEM);
  if (options.tool !== false)
    builder.tool(
      defineTool({
        name: options.tool ?? TOOL,
        description: 'A local authored fixture; no external call.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => 'unused',
      }),
    );
  const agent = builder.build();
  await agent.run({ message: 'Give the public answer.' });
  expect(wire).toHaveLength(1);
  const snapshot = agent.getSnapshot()!;
  const view = servedAt(snapshot, 1)!;
  expect(view).toBeDefined();
  return { snapshot, view, wire: wire[0]! };
}

describe('privacy under a native safe replay base', () => {
  it('keeps withheld system and tool fields unknown independently of the native fold base', async () => {
    const { snapshot, view, wire } = await recorded({ redact: policy() });
    expect(wire.system).toContain(SYSTEM);
    expect(wire.tools).toContain(TOOL);
    const hasBase = await nativeRetainsSafeBase();
    expect(snapshot.initialState !== undefined).toBe(hasBase);
    expect(JSON.stringify(snapshot)).not.toContain(SYSTEM);
    expect(snapshot.sharedState.systemPromptInjections).toBe('REDACTED');
    expect(snapshot.sharedState.dynamicToolSchemas).toBe('REDACTED');
    expect(receiptAt(snapshot, 1)!.system.chars).toBeGreaterThan(0);
    expect(view.system.text).toBe('');
    expect(view.tools.names).toEqual([]);
    expect(view.tools.schemas).toEqual([]);
    expect(view.gaps.some((gap) => gap.gap === 'no-fold-base')).toBe(!hasBase);

    // A cache boundary is not an explanation for values the record withheld.
    // The existing conformance law likewise treats it as a weaker relation.
    const missingValueGaps = view.gaps.filter(
      (gap) =>
        ![
          'cache-transform',
          'provider-defaults',
          'thinking-replay',
          'no-receipt-on-chart',
        ].includes(gap.gap),
    );
    const unexplained = [
      'system.chars',
      'system.pieces',
      'tools.names',
      'tools.schemaHashes',
    ].filter((field) => !missingValueGaps.some((gap) => gap.fields.includes(field)));
    expect(
      unexplained,
      `Privacy-withheld values need a missing-value caveat; got ${view.gaps
        .map((gap) => gap.gap)
        .join(', ')}`,
    ).toEqual([]);
    expect(view.gaps.map((gap) => gap.gap)).toContain('privacy-policy');
    expect(JSON.stringify(view)).not.toContain(SYSTEM);
  });

  it('a genuinely empty unredacted request remains empty without a privacy warning', async () => {
    const { view, wire } = await recorded({ system: '', tool: false });
    expect(wire.system).toBe('');
    expect(wire.tools).toEqual([]);
    expect(view.system.text).toBe('');
    expect(view.tools.names).toEqual([]);
    expect(view.gaps.map((gap) => gap.gap)).not.toContain('privacy-policy');
  });

  it('literal placeholders are values without the positive policy marker', async () => {
    const { view, wire } = await recorded({ system: 'REDACTED', tool: 'REDACTED' });
    expect(wire.system).toBe('REDACTED');
    expect(wire.tools).toEqual(['REDACTED']);
    expect(view.system.text).toBe(wire.system);
    expect(view.tools.names).toEqual(wire.tools);
    expect(view.gaps.map((gap) => gap.gap)).not.toContain('privacy-policy');
  });

  it('a policy that withholds none of these values preserves the nonempty request', async () => {
    const { view, wire } = await recorded({ redact: { keys: ['not_on_this_run'] } });
    expect(wire.system).toContain(SYSTEM);
    expect(wire.tools).toContain(TOOL);
    expect(view.system.text).toBe(wire.system);
    expect(view.tools.names).toEqual(wire.tools);
    const gap = view.gaps.find((item) => item.gap === 'privacy-policy');
    expect(gap).toBeDefined();
    expect(gap!.why).toContain('may');
  });

  it('JSON round-tripping retains the privacy warning without inventing a missing base', async () => {
    const { snapshot } = await recorded({ redact: policy() });
    const json = JSON.parse(JSON.stringify(snapshot));
    const view = servedAt(json, 1)!;
    expect(view.gaps.map((gap) => gap.gap)).toContain('privacy-policy');
    expect(view.gaps.some((gap) => gap.gap === 'no-fold-base')).toBe(
      !(await nativeRetainsSafeBase()),
    );
    expect(JSON.stringify(view)).not.toContain(SYSTEM);
  });

  it('a deliberately stripped private base retains both independent limitations', async () => {
    const { snapshot } = await recorded({ redact: policy() });
    const stripped = structuredClone(snapshot);
    expect(stripped.initialState !== undefined).toBe(await nativeRetainsSafeBase());
    delete stripped.initialState;
    const view = servedAt(stripped, 1)!;
    expect(view.gaps.map((gap) => gap.gap)).toContain('no-fold-base');
    expect(view.gaps.map((gap) => gap.gap)).toContain('privacy-policy');
    expect(JSON.stringify(view)).not.toContain(SYSTEM);
  });
});
