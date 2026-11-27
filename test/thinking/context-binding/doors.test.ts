/**
 * Each door that edits a request's context between two calls, on a bound
 * model: refused, by name, inside a signed open tool turn; recorded (not
 * refused) when the reasoning's turn is over or the wire left it out;
 * `unchecked` when the conversation came from an earlier run.
 *
 * The oracle for every refusal is the independent comparator over the
 * witness run's request bodies (reply 1 unsigned, so request 2 is sent): the
 * slots it finds changed are the slots the refusal names.
 *
 * Test type: integration (real agent loop and adapter, scripted SDK client).
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { defineFact, defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { ContextChangedError } from '../../../src/providers.js';
import { gatedTools, skillScopedTools, staticTools } from '../../../src/tool-providers/index.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';
import { prefixDiff, scriptedClient, type Body, type Step } from './harness.js';

const MODEL = 'claude-sonnet-5-5';
const t = (name: string) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name}:ran`,
  });

type Builder = ReturnType<typeof Agent.create>;

// Slice 1's refusal is exercised on the skill context that still edits the turn: the app's `declared`.
async function run(script: readonly Step[], build: (a: Builder) => Builder, maxIterations = 5) {
  const bodies: Body[] = [];
  const provider: LLMProvider = anthropic({
    _client: scriptedClient(MODEL, bodies, script) as never,
  });
  const agent = build(
    Agent.create({ provider, model: MODEL, maxIterations, skillContext: 'declared' }).system(
      'You diagnose.',
    ),
  ).build();
  const starts: Record<string, unknown>[] = [];
  agent.on('agentfootprint.stream.llm_start', (e) => starts.push(e.payload as never));
  const omitted: unknown[] = [];
  agent.on('agentfootprint.agent.thinking_omitted', (e) => omitted.push(e.payload));
  let error: unknown;
  try {
    await agent.run({ message: 'Why is the finance share slow?' });
  } catch (caught) {
    error = caught;
  }
  return { agent, bodies, starts, omitted, error };
}

const unsigned = (script: readonly Step[]): Step[] => [
  { ...script[0], thinking: false },
  ...script.slice(1),
];

/** Refused with the named changes, and the oracle finds the same slots. */
async function expectRefused(
  script: readonly Step[],
  build: (a: Builder) => Builder,
  sentence: RegExp,
) {
  const signed = await run(script, build);
  expect(signed.error).toBeInstanceOf(ContextChangedError);
  const error = signed.error as ContextChangedError;
  expect(error.message).toMatch(sentence);
  expect(signed.bodies).toHaveLength(1);
  const witness = await run(unsigned(script), build);
  expect(witness.error).toBeUndefined();
  const diff = prefixDiff(witness.bodies[0], witness.bodies[1]);
  const slots = new Set(error.changes.map((c) => c.slot));
  expect(diff.system).toBe(slots.has('system-prompt'));
  const toolNames = (kind: string) =>
    error.changes.filter((c) => c.slot === 'tools' && c.change === kind).map((c) => c.tool);
  expect(diff.toolsAdded).toEqual(toolNames('added'));
  expect(diff.toolsRemoved).toEqual(toolNames('removed'));
  expect(diff.toolsChanged).toEqual(toolNames('changed'));
  return error;
}

describe('doors refused inside a signed open tool turn', () => {
  it('a rule-triggered fact (system prompt)', async () => {
    await expectRefused(
      [{ tool: 'lookup' }, { text: 'done' }],
      (a) =>
        a.tool(t('lookup')).fact(
          defineFact({
            id: 'after-first-call',
            activeWhen: (ctx) => ctx.iteration > 1,
            data: 'The finance share sits on filer 2.',
          }),
        ),
      /fact 'after-first-call' was added to the system prompt/,
    );
  });

  it('a tool provider scoped to a skill (skillScopedTools)', async () => {
    await expectRefused(
      [{ tool: 'read_skill', input: { id: 'billing' } }, { text: 'done' }],
      (a) =>
        a
          .skill(defineSkill({ id: 'billing', description: 'Billing.', body: 'B' }))
          .toolProvider(skillScopedTools('billing', [t('refund_tool')])),
      /tool 'refund_tool' was added \(from tool provider 'skill-scoped:billing'\)/,
    );
  });

  it('a gated provider whose predicate moves between iterations (gatedTools)', async () => {
    await expectRefused(
      [{ tool: 'lookup' }, { text: 'done' }],
      (a) =>
        a.toolProvider(
          gatedTools(
            staticTools([t('lookup'), t('escalate')]),
            (name, ctx) => name === 'lookup' || ctx.iteration > 1,
          ),
        ),
      /tool 'escalate' was added/,
    );
  });

  it('a skill graph step moves the cursor (body and read_skill description)', async () => {
    const skill = (id: string) =>
      defineSkill({
        id,
        description: `${id} does things`,
        body: `${id}_BODY`,
        tools: [t(`${id}_tool`)],
      });
    const error = await expectRefused(
      [{ tool: 'alpha_tool' }, { text: 'done' }],
      (a) =>
        a.skillGraph(
          skillGraph({
            skills: [skill('alpha'), skill('beta')],
            start: 'alpha',
            steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
            check: 'off',
          }),
        ),
      /skill 'beta' was added to the system prompt/,
    );
    expect(error.changes).toContainEqual(
      expect.objectContaining({ slot: 'tools', change: 'changed', tool: 'read_skill' }),
    );
  });
});

describe('doors recorded, not refused', () => {
  it('the wrap-up withdraws the tools and leaves the signed turn out of the wire', async () => {
    const result = await run(
      [{ tool: 'lookup' }, { tool: 'lookup' }, { text: 'done' }],
      (a) => a.tool(t('lookup')),
      1,
    );
    expect(result.error).toBeUndefined();
    expect(result.bodies).toHaveLength(2);
    const wrapUp = result.starts.at(-1)?.contextChange as {
      check: string;
      refused: boolean;
      changes: unknown[];
    };
    expect(wrapUp).toMatchObject({ check: 'compared', refused: false });
    expect(wrapUp.changes).toContainEqual({
      slot: 'tools',
      change: 'removed',
      tool: 'lookup',
      party: { channel: 'registry' },
    });
    expect(wrapUp.changes).toContainEqual({
      slot: 'messages',
      change: 'removed',
      position: 1,
      role: 'assistant',
    });
    // The oracle: the tool really left the wire, and so did the signed turn.
    const diff = prefixDiff(result.bodies[0], result.bodies[1]);
    expect(diff.toolsRemoved).toEqual(['lookup']);
    expect(result.bodies[1].messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('a conversation continued from an earlier run is recorded unchecked and still sent', async () => {
    const first = await run([{ text: 'Turn one.' }], (a) => a.tool(t('lookup')));
    expect(first.error).toBeUndefined();
    const starts: Record<string, unknown>[] = [];
    first.agent.on('agentfootprint.stream.llm_start', (e) => starts.push(e.payload as never));
    await first.agent.followUp('And the HR share?');
    expect(first.bodies).toHaveLength(2);
    expect(starts[0]?.contextChange).toEqual({
      check: 'unchecked',
      refused: false,
      binding: 'bound',
      by: 'provider',
      changes: [],
    });
  });
});
