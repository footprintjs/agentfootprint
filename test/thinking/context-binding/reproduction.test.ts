/**
 * The skill-load reproduction, and the reviewer's probes, on a model that
 * binds its reasoning to its context.
 *
 * Each refused case runs twice over the same script. The SIGNED run (reply 1
 * carries a signed thinking block) must stop before request 2 with
 * `ContextChangedError` naming the change. The WITNESS run (reply 1 carries
 * no thinking, so nothing is bound and request 2 is sent) gives the oracle
 * the request the signed run refused: the independent comparator over the
 * client's two bodies must find exactly the slots the refusal named.
 *
 * Test type: integration (the real agent loop and adapter, a scripted SDK
 * client) / regression.
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { defineInstruction, defineSkill } from '../../../src/injection-engine.js';
import { ContextChangedError, UnsafeThinkingReplayError } from '../../../src/providers.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';
import { prefixDiff, scriptedClient, unchanged, type Body, type Step } from './harness.js';

const MODEL = 'claude-haiku-5-5';

const lookup = defineTool<{ key: string }, string>({
  name: 'lookup',
  description: 'Look a key up in the reference table.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
    additionalProperties: false,
  },
  execute: async ({ key }) => `value of ${key}`,
});

const shareReport = defineTool<{ share: string }, string>({
  name: 'share_report',
  description: 'Report on one SMB share.',
  inputSchema: {
    type: 'object',
    properties: { share: { type: 'string' } },
    required: ['share'],
    additionalProperties: false,
  },
  execute: async ({ share }) => `report for ${share}`,
});

type Variant = 'scoped' | 'static-tools' | 'tool-only';

const skillFor = (variant: Variant) =>
  defineSkill({
    id: 'smb-triage',
    description: 'Diagnose slow SMB shares.',
    body: 'SMB TRIAGE: check the share report first, then latency.',
    tools: [shareReport],
    ...(variant === 'scoped' && { autoActivate: 'currentSkill' as const }),
    ...(variant === 'tool-only' && { surfaceMode: 'tool-only' as const }),
  });

type Build = (agent: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>;

async function run(
  mode: 'stream' | 'complete',
  script: readonly Step[],
  build: Build,
  options: {
    readonly thinking?: boolean;
    readonly model?: string;
    readonly reactMode?: 'dynamic' | 'dynamic-grouped';
    readonly thinkingBinding?: (model: string) => 'bound' | 'unbound' | undefined;
  } = {},
) {
  const model = options.model ?? MODEL;
  const bodies: Body[] = [];
  const real = anthropic({
    _client: scriptedClient(model, bodies, script) as never,
    ...(options.thinkingBinding !== undefined && { thinkingBinding: options.thinkingBinding }),
  });
  const provider: LLMProvider =
    mode === 'stream' ? real : (({ stream: _stream, ...rest }) => rest)(real);
  let builder = build(
    Agent.create({
      provider,
      model,
      maxIterations: 5,
      ...(options.reactMode !== undefined && { reactMode: options.reactMode }),
    }).system('You diagnose file-share problems.'),
  );
  if (options.thinking !== false) builder = builder.thinking({ budget: 1500 });
  const agent = builder.build();
  const starts: unknown[] = [];
  agent.on('agentfootprint.stream.llm_start', (event) => starts.push(event.payload));
  try {
    const answer = await agent.run({ message: 'Why is the finance share slow?' });
    return { bodies, starts, answer, error: undefined as unknown };
  } catch (error) {
    return { bodies, starts, answer: undefined, error };
  }
}

const signedThenUnsigned = (steps: readonly Step[]): readonly Step[] => [
  { ...steps[0], thinking: false },
  ...steps.slice(1),
];

const READ_SKILL: readonly Step[] = [
  { tool: 'read_skill', input: { id: 'smb-triage' } },
  { text: 'The finance share is slow because of latency.' },
];
const LOOKUP: readonly Step[] = [
  { tool: 'lookup', input: { key: 'finance' } },
  { text: 'The finance share is slow because of latency.' },
];

interface RefusalCase {
  readonly name: string;
  readonly script: readonly Step[];
  readonly build: Build;
  readonly thinking?: boolean;
  readonly model?: string;
  readonly sentence: RegExp;
}

const REFUSED: readonly RefusalCase[] = [
  {
    name: 'skill load, tools appear when active (the default)',
    script: READ_SKILL,
    build: (a) => a.tool(lookup).skill(skillFor('scoped')),
    sentence:
      /skill 'smb-triage' was added to the system prompt; tool 'share_report' was added \(from skill 'smb-triage'\)/,
  },
  {
    name: 'skill load, tools always listed, body to the system prompt',
    script: READ_SKILL,
    build: (a) => a.tool(lookup).skill(skillFor('static-tools')),
    sentence: /skill 'smb-triage' was added to the system prompt\./,
  },
  {
    name: 'an instruction whose activeWhen reads the tool result (no skill)',
    script: LOOKUP,
    build: (a) =>
      a.tool(lookup).instruction(
        defineInstruction({
          id: 'after-lookup',
          activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'lookup',
          prompt: 'Lookup values are approximate.',
        }),
      ),
    sentence: /instructions 'after-lookup' was added to the system prompt/,
  },
  ...['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'].map(
    (model): RefusalCase => ({
      name: `skill load with no .thinking() configured on ${model}`,
      script: READ_SKILL,
      build: (a) => a.tool(lookup).skill(skillFor('scoped')),
      thinking: false,
      model,
      sentence: /tool 'share_report' was added \(from skill 'smb-triage'\)/,
    }),
  ),
];

describe('a bound model refuses, by name, a tool turn whose context changed', () => {
  for (const mode of ['stream', 'complete'] as const) {
    for (const c of REFUSED) {
      it(`${mode}: ${c.name}`, async () => {
        const signed = await run(mode, c.script, c.build, c);
        expect(signed.error).toBeInstanceOf(ContextChangedError);
        expect(signed.error).not.toBeInstanceOf(UnsafeThinkingReplayError);
        const error = signed.error as ContextChangedError;
        expect(error.message).toMatch(c.sentence);
        expect(error.message).toMatch(/^Refused before sending: /);
        expect(error.retryable).toBe(false);
        expect(error.code).toBe('CONTEXT_CHANGED_IN_TURN');
        // The refused request never reached the client.
        expect(signed.bodies).toHaveLength(1);
        // Recorded on llm_start with the same names.
        const last = signed.starts.at(-1) as {
          contextChange?: { refused: boolean; changes: unknown };
        };
        expect(last.contextChange).toEqual({
          check: 'compared',
          refused: true,
          binding: 'bound',
          by: 'provider',
          changes: error.changes,
        });

        // The oracle, over the witness run's real request 2.
        const witness = await run(mode, signedThenUnsigned(c.script), c.build, c);
        expect(witness.error).toBeUndefined();
        const diff = prefixDiff(witness.bodies[0], witness.bodies[1]);
        const named = error.changes;
        expect(diff.system).toBe(named.some((x) => x.slot === 'system-prompt'));
        expect(diff.toolsAdded).toEqual(
          named.filter((x) => x.slot === 'tools' && x.change === 'added').map((x) => x.tool),
        );
        expect(diff.toolsRemoved).toEqual(
          named.filter((x) => x.slot === 'tools' && x.change === 'removed').map((x) => x.tool),
        );
        expect(diff.toolsChanged).toEqual(
          named.filter((x) => x.slot === 'tools' && x.change === 'changed').map((x) => x.tool),
        );
        expect(diff.messages).toEqual([]);
      });
    }

    it(`${mode}: tools always listed and the body only in the read_skill result still passes`, async () => {
      const signed = await run(mode, READ_SKILL, (a) =>
        a.tool(lookup).skill(skillFor('tool-only')),
      );
      expect(signed.error).toBeUndefined();
      expect(signed.bodies).toHaveLength(2);
      expect(unchanged(prefixDiff(signed.bodies[0], signed.bodies[1]))).toBe(true);
      // Nothing changed, so nothing is recorded.
      for (const start of signed.starts) expect(start).not.toHaveProperty('contextChange');
    });

    it(`${mode}: a plain tool call passes and records nothing`, async () => {
      const signed = await run(mode, LOOKUP, (a) => a.tool(lookup));
      expect(signed.error).toBeUndefined();
      expect(unchanged(prefixDiff(signed.bodies[0], signed.bodies[1]))).toBe(true);
      for (const start of signed.starts) expect(start).not.toHaveProperty('contextChange');
    });
  }
});

const PROFILE = 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/team-haiku';

describe('a model id the adapter cannot place: sent, and the change recorded by name', () => {
  for (const model of ['claude-opus-6', PROFILE]) {
    it(`${model}: the request is sent and llm_start names the change, binding unknown`, async () => {
      const signed = await run(
        'stream',
        READ_SKILL,
        (a) => a.tool(lookup).skill(skillFor('scoped')),
        {
          model,
        },
      );
      expect(signed.error).toBeUndefined();
      expect(signed.bodies).toHaveLength(2);
      const note = signed.starts[1] as { contextChange?: Record<string, unknown> };
      expect(note.contextChange).toMatchObject({
        check: 'compared',
        refused: false,
        binding: 'unknown',
        by: 'provider',
      });
      const changes = note.contextChange?.changes as {
        slot: string;
        change: string;
        tool?: string;
      }[];
      // The oracle, over the request the adapter really sent.
      const diff = prefixDiff(signed.bodies[0], signed.bodies[1]);
      expect(diff.system).toBe(changes.some((c) => c.slot === 'system-prompt'));
      expect(diff.toolsAdded).toEqual(
        changes.filter((c) => c.slot === 'tools' && c.change === 'added').map((c) => c.tool),
      );
      expect(diff.toolsAdded).toEqual(['share_report']);
      expect(diff.messages).toEqual([]);
    });
  }

  it('the app states the profile bound: the named refusal, recorded by app', async () => {
    const signed = await run(
      'stream',
      READ_SKILL,
      (a) => a.tool(lookup).skill(skillFor('scoped')),
      {
        model: PROFILE,
        thinkingBinding: (id) => (id === PROFILE ? 'bound' : undefined),
      },
    );
    expect(signed.error).toBeInstanceOf(ContextChangedError);
    expect(signed.bodies).toHaveLength(1);
    expect((signed.starts.at(-1) as { contextChange?: unknown }).contextChange).toMatchObject({
      refused: true,
      binding: 'bound',
      by: 'app',
    });
  });

  it('the app states the profile unbound: sent, nothing recorded', async () => {
    const signed = await run(
      'stream',
      READ_SKILL,
      (a) => a.tool(lookup).skill(skillFor('scoped')),
      {
        model: PROFILE,
        thinkingBinding: () => 'unbound',
      },
    );
    expect(signed.error).toBeUndefined();
    expect(signed.bodies).toHaveLength(2);
    for (const start of signed.starts) expect(start).not.toHaveProperty('contextChange');
  });
});

describe('the grouped chart refuses the same way', () => {
  it('dynamic-grouped: skill load, tools appear when active', async () => {
    const signed = await run(
      'stream',
      READ_SKILL,
      (a) => a.tool(lookup).skill(skillFor('scoped')),
      {
        reactMode: 'dynamic-grouped',
      },
    );
    expect(signed.error).toBeInstanceOf(ContextChangedError);
    expect((signed.error as ContextChangedError).message).toMatch(
      /tool 'share_report' was added \(from skill 'smb-triage'\)/,
    );
    expect(signed.bodies).toHaveLength(1);
  });
});

describe('a model that does not bind its reasoning is untouched', () => {
  it('claude-haiku-4-5 loads the skill mid-turn as before, with no record', async () => {
    const signed = await run(
      'stream',
      READ_SKILL,
      (a) => a.tool(lookup).skill(skillFor('scoped')),
      {
        model: 'claude-haiku-4-5',
      },
    );
    expect(signed.error).toBeUndefined();
    expect(signed.bodies).toHaveLength(2);
    for (const start of signed.starts) expect(start).not.toHaveProperty('contextChange');
  });
});
