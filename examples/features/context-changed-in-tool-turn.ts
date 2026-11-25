/**
 * A tool turn that changes its own context, on a model that binds its
 * reasoning to that context — refused by name, and the setup that passes.
 *
 * Claude models with preserved thinking (Haiku, Sonnet and Opus 5.5, Fable
 * 5.1 and 5.2, Mythos 5.1 and 5.2) accept a signed thinking block only under
 * the system prompt, tool list and earlier messages it was written under. A
 * skill loaded with `read_skill` in the middle of a tool turn adds its body to
 * the system prompt and, scoped, its tools to the list. The agent refuses that
 * request before sending it, with `ContextChangedError` naming what changed.
 *
 * Nothing leaves the process: the SDK client is replaced by a stand-in that
 * records each request body and answers from a script.
 *
 * Run:  npm run example examples/features/context-changed-in-tool-turn.ts
 */
import assert from 'node:assert/strict';
import { Agent, defineTool } from '../../src/index.js';
import { anthropic, ContextChangedError } from '../../src/doors/providers.js';
import { defineSkill } from '../../src/doors/context.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/context-changed-in-tool-turn',
  title: 'A changed tool turn, refused by name',
  group: 'features',
  description:
    'A skill loaded mid-turn on Claude Haiku 5.5 is refused before sending with ContextChangedError naming the skill and its tool; the same skill with its tools always listed and its body in the read_skill result passes.',
  defaultInput: 'Why is the finance share slow?',
  providerSlots: [],
  tags: ['features', 'provider', 'anthropic', 'thinking', 'skills'],
};

type Body = Record<string, unknown>;

/** A stand-in for `@anthropic-ai/sdk`: a signed `read_skill` call, then an answer. */
function recordingClient(bodies: Body[]) {
  let n = 0;
  const create = async (params: unknown) => {
    bodies.push(params as Body);
    n += 1;
    const first = n === 1;
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: 'stand-in',
      content: first
        ? [
            { type: 'thinking', thinking: 'Load the triage skill.', signature: 'fixture-sig' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_skill', input: { id: 'smb-triage' } },
          ]
        : [{ type: 'text', text: 'The share report shows high latency.' }],
      stop_reason: first ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 12, output_tokens: 9 },
    };
  };
  return { messages: { create } } as never;
}

const shareReport = defineTool<{ share: string }, string>({
  name: 'share_report',
  description: 'Report on one SMB share.',
  inputSchema: { type: 'object', properties: { share: { type: 'string' } } },
  execute: async ({ share }) => `report for ${share}`,
});

async function ask(
  input: string,
  skill: ReturnType<typeof defineSkill>,
  model = 'claude-haiku-5-5',
  thinkingBinding?: (id: string) => 'bound' | 'unbound' | undefined,
) {
  const bodies: Body[] = [];
  // The stand-in has no `stream`, so the agent calls `complete`.
  const { stream: _stream, ...provider } = anthropic({
    _client: recordingClient(bodies),
    ...(thinkingBinding !== undefined && { thinkingBinding }),
  });
  const agent = Agent.create({ provider, model })
    .system('You diagnose file-share problems.')
    .skill(skill)
    .thinking({ budget: 2000 })
    .build();
  return { bodies, outcome: await agent.run({ message: input }).catch((error: unknown) => error) };
}

export async function run(input: string): Promise<unknown> {
  // #region refused
  const scoped = defineSkill({
    id: 'smb-triage',
    description: 'Diagnose slow SMB shares.',
    body: 'Check the share report first, then latency.',
    tools: [shareReport],
    autoActivate: 'currentSkill', // its tools appear only once it is loaded
  });
  const refused = await ask(input, scoped);
  if (refused.outcome instanceof ContextChangedError) {
    console.log(refused.outcome.message);
    // Refused before sending: claude-haiku-5-5 binds its reasoning to the context it was
    // written under, and this tool turn changed that context: skill 'smb-triage' was added
    // to the system prompt; tool 'share_report' was added (from skill 'smb-triage'). …
    console.log(refused.outcome.changes); // the same, as data: slot, source, id, tool
  }
  // #endregion refused
  assert.ok(refused.outcome instanceof ContextChangedError);
  assert.equal(refused.bodies.length, 1); // the changed request was never sent

  // #region passes
  // Until the agent can append these changes itself: list the tools from the
  // first request and deliver the body only in the read_skill result.
  const listed = defineSkill({
    id: 'smb-triage',
    description: 'Diagnose slow SMB shares.',
    body: 'Check the share report first, then latency.',
    tools: [shareReport], // no autoActivate: listed from the first request
    surfaceMode: 'tool-only', // the body travels in the read_skill result
  });
  const passed = await ask(input, listed);
  // #endregion passes
  assert.ok(!(passed.outcome instanceof Error));
  assert.equal(passed.bodies.length, 2);
  assert.deepEqual(passed.bodies[0]!.system, passed.bodies[1]!.system);

  // #region declare
  // An inference profile the adapter's table cannot place: its binding is
  // unknown, so the changed turn is sent and recorded, not refused. Say what
  // the profile serves, and the same turn gets the named refusal.
  const profile = 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/team-haiku';
  const unknown = await ask(input, scoped, profile);
  const declared = await ask(input, scoped, profile, (id) =>
    id === profile ? 'bound' : undefined,
  );
  // #endregion declare
  assert.equal(unknown.bodies.length, 2); // sent; llm_start records binding: 'unknown'
  assert.ok(declared.outcome instanceof ContextChangedError);

  return {
    refused: (refused.outcome as ContextChangedError).changes,
    declared: (declared.outcome as ContextChangedError).changes.length,
    passed: (passed.outcome as { content?: string }).content ?? passed.outcome,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!)
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
