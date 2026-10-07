/**
 * 95 — Keep personal data out of an agent's records: `Agent.create({ redact })`.
 *
 * One door, a footprintjs `RedactionPolicy`, for everything the library keeps
 * or serves about the agent's runs — the snapshot, the narrative, every event,
 * recordings, and everything built from them (bug reports, answer accounts,
 * traces). It never touches what the agent computes on or hands back: the
 * model and the tool get the real values, and so does the caller.
 *
 * Policies select by NAME. `conversationRedaction()` is the library's own list
 * of the names an agent's record carries the conversation under; join the
 * fields your tools name (`/ssn|email/i`).
 *
 * Run:  npm run example examples/features/95-agent-redaction.ts
 */
import assert from 'node:assert/strict';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { accountForAnswer, recordRun } from '../../src/doors/observe.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { LLMProvider, LLMRequest } from '../../src/adapters/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/95-agent-redaction',
  title: 'Agent redaction',
  group: 'features',
  description:
    'A mock agent looks a citizen up by SSN. Under conversationRedaction() no message, argument, result or answer text reaches the snapshot, the narrative, the events or the recording — while the model, the tool and the caller get the real values.',
  defaultInput: 'Find the citizen with SSN 123-45-6789.',
  providerSlots: [],
  tags: ['features', 'security', 'observability'],
};

const SSN = '123-45-6789';
const EMAIL = 'ada@example.org';

export async function run(input: string): Promise<unknown> {
  // What the model and the tool really receive — the live-input control.
  const modelSaw: string[] = [];
  const toolSaw: unknown[] = [];
  const inner = mock({
    replies: [
      { toolCalls: [{ id: 'c1', name: 'lookup', args: { ssn: SSN } }] },
      { content: 'Found her: Ada. Her contact details are in the file.' },
    ],
  });
  const provider: LLMProvider = {
    name: inner.name,
    complete: async (request: LLMRequest) => {
      modelSaw.push(JSON.stringify(request));
      return inner.complete(request);
    },
  };
  const lookup = defineTool<{ ssn: string }, unknown>({
    name: 'lookup',
    description: 'Look a citizen up by SSN.',
    inputSchema: { type: 'object', properties: { ssn: { type: 'string' } }, required: ['ssn'] },
    execute: (args) => {
      toolSaw.push(args);
      return { name: 'Ada', email: EMAIL };
    },
  });

  // #region redact
  const agent = Agent.create({
    provider,
    model: 'mock',
    // The conversation, wherever the library carries it — and the fields
    // this app's own tools name, wherever they appear.
    redact: conversationRedaction({ patterns: [/ssn|email/i] }),
  })
    .tool(lookup)
    .build();

  const recorder = recordRun(agent);
  const answer = await agent.run({ message: input }); // the real answer
  const recording = recorder.toRecording(); // what you store or send
  // #endregion redact

  // The caller, the model and the tool got the real values…
  assert.ok(String(answer).startsWith('Found her'));
  assert.ok(modelSaw.some((request) => request.includes(SSN)));
  assert.ok(modelSaw.some((request) => request.includes(EMAIL))); // the tool's result
  assert.deepEqual(toolSaw, [{ ssn: SSN }]);

  // …and no record of the run holds them: not the message, the argument, the
  // result or the answer's text. (One named limit: the run's OUTPUT — the
  // answer as the chart returns it — rides `run.exit`; `src/redaction/README.md`.)
  const records = {
    snapshot: agent.getLastSnapshot(),
    narrative: agent.getLastNarrativeEntries(),
    recording,
  };
  for (const [name, value] of Object.entries(records)) {
    const text = JSON.stringify(value);
    assert.ok(!text.includes(SSN), `${name} holds the SSN`);
    assert.ok(!text.includes(EMAIL), `${name} holds the email`);
    assert.ok(!text.includes(input), `${name} holds the message`);
  }

  // #region account
  // Readers of the record say what it keeps out — never that it did not happen.
  const account = accountForAnswer(recording);
  // #endregion account
  assert.equal(account.question.missing, 'redacted');
  assert.equal(account.answer.missing, 'redacted');

  return {
    answer,
    question: account.rows[0]?.lines[0]?.text,
    recordedEvents: recording.events.length,
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
