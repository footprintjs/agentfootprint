/**
 * Skills on a model that binds its reasoning to its context: every skill tool
 * listed from the first request, the body delivered as the `read_skill` result.
 *
 * Claude models with preserved thinking accept a signed thinking block only
 * under the system prompt and tool list it was written under. On such a model
 * the agent's default skill context is `listed`: loading a skill in the middle
 * of a tool turn changes neither, so the turn goes on. The choice, and the
 * rule that made it, is on the first `llm_start` of the run.
 *
 * Nothing leaves the process: the SDK client is replaced by a stand-in that
 * records each request body and answers from a script.
 *
 * Run:  npm run example examples/features/skills-listed.ts
 */
import assert from 'node:assert/strict';
import { Agent, defineTool } from '../../src/index.js';
import { anthropic } from '../../src/doors/providers.js';
import { defineSkill } from '../../src/doors/context.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/skills-listed',
  title: 'Skills that keep a signed tool turn intact',
  group: 'features',
  description:
    'On Claude Haiku 5.5 a scoped skill is listed from the first request and its body arrives as the read_skill result, so a load mid-turn changes nothing; a call to its tool before the load is refused and does not run.',
  defaultInput: 'Why is the finance share slow?',
  providerSlots: [],
  tags: ['features', 'provider', 'anthropic', 'thinking', 'skills'],
};

type Body = { system?: unknown; tools?: { name: string }[]; messages: unknown[] };
type Reply = { tool?: string; input?: Record<string, unknown>; text?: string };

/** A stand-in for `@anthropic-ai/sdk`: each reply signed, as the newest Claude models answer. */
function recordingClient(bodies: Body[], script: readonly Reply[]) {
  let n = 0;
  const create = async (params: Body & { model: string }) => {
    bodies.push(JSON.parse(JSON.stringify(params)) as Body);
    const step = script[Math.min(n, script.length - 1)]!;
    n += 1;
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content: [
        { type: 'thinking', thinking: 'Plan the next step.', signature: `fixture-sig-${n}` },
        ...(step.tool !== undefined
          ? [{ type: 'tool_use', id: `toolu_${n}`, name: step.tool, input: step.input ?? {} }]
          : [{ type: 'text', text: step.text ?? '' }]),
      ],
      stop_reason: step.tool !== undefined ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 12, output_tokens: 9 },
    };
  };
  return { messages: { create } } as never;
}

let reports = 0;
const shareReport = defineTool<{ share: string }, string>({
  name: 'share_report',
  description: 'Report on one SMB share.',
  inputSchema: { type: 'object', properties: { share: { type: 'string' } } },
  execute: async ({ share }) => {
    reports += 1;
    return `report for ${share}: high latency`;
  },
});

const triage = defineSkill({
  id: 'smb-triage',
  description: 'Diagnose slow SMB shares.',
  body: 'Check the share report first, then latency.',
  tools: [shareReport],
  autoActivate: 'currentSkill',
});

async function ask(input: string, script: readonly Reply[]) {
  const bodies: Body[] = [];
  // The stand-in has no `stream`, so the agent calls `complete`.
  const { stream: _stream, ...provider } = anthropic({ _client: recordingClient(bodies, script) });
  const agent = Agent.create({ provider, model: 'claude-haiku-5-5' })
    .system('You diagnose file-share problems.')
    .skill(triage)
    .thinking({ budget: 2000 })
    .build();
  const starts: Record<string, unknown>[] = [];
  agent.on('agentfootprint.stream.llm_start', (event) => starts.push(event.payload as never));
  const answer = await agent.run({ message: input });
  return { bodies, starts, answer };
}

export async function run(input: string): Promise<unknown> {
  reports = 0;
  // #region listed
  const loaded = await ask(input, [
    { tool: 'read_skill', input: { id: 'smb-triage' } },
    { tool: 'share_report', input: { share: 'finance' } },
    { text: 'The finance share shows high latency.' },
  ]);
  // Request 1 already lists share_report; every request sends the same system prompt and tools.
  console.log(loaded.bodies.map((body) => (body.tools ?? []).map((tool) => tool.name)));
  // Why: { tools: { strategy: 'listed', by: 'rule', rule: 0, label: 'The model binds …', reads: ['binding'] }, … }
  console.log(loaded.starts[0]!.skillContext);
  // #endregion listed
  assert.equal(loaded.bodies.length, 3);
  const names = (body: Body) => (body.tools ?? []).map((tool) => tool.name);
  for (const body of loaded.bodies) assert.deepEqual(names(body), names(loaded.bodies[0]!));
  assert.ok(names(loaded.bodies[0]!).includes('share_report'));

  // #region early
  // A call to the skill's tool before the skill is loaded does not run; the model is told the next step.
  const early = await ask(input, [
    { tool: 'share_report', input: { share: 'finance' } },
    { text: 'I need to load the triage skill first.' },
  ]);
  // "Tool 'share_report' did not run: it belongs to skill 'smb-triage', which was not loaded on that call; …"
  // #endregion early
  assert.equal(early.bodies.length, 2);
  assert.equal(reports, 1); // only the loaded run's call ran

  return {
    toolsOnRequestOne: (loaded.bodies[0]!.tools ?? []).map((tool) => tool.name),
    skillContext: loaded.starts[0]!.skillContext,
    answer: (loaded.answer as { content?: string }).content ?? loaded.answer,
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
