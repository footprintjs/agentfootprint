/**
 * 116 — a doubt names where it came from: `reasons[].source` and `displayName`.
 *
 * Every reason the answer's standing fold fires says, as data, what it rests
 * on — specific calls (`{ kind: 'calls', calls: [{ toolCallId, toolName }] }`),
 * the answer itself (`{ kind: 'answer' }`) or the run as a whole
 * (`{ kind: 'run' }`). The kind is declared once per reason; the calls are read
 * off the reason's own rows. Names and ids only — never an argument or a result.
 *
 * A tool may declare `displayName`, the app's own words for what a call does.
 * The standing line names a reason's calls ONLY by it ("Not sure — loading the
 * attached data found nothing."), and the limits block marks the items that
 * call declared the same way. Without one, every word is what it always was:
 * the registered tool name is never shown to the person.
 *
 * Run:  npm run example examples/features/116-reason-sources.ts
 */

import { Agent, absent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/116-reason-sources',
  title: 'A doubt names where it came from — reasons[].source and a tool’s displayName',
  group: 'features',
  description:
    'Each reason of the answer’s standing says what it rests on (calls, the answer, or the run); ' +
    'a tool’s displayName lets the standing line and the limits block name a call in the app’s ' +
    'own words, never the registered tool name.',
  defaultInput: 'Which runs used the attached data?',
  // Scripted on purpose: the standing is pinned, which a live model would not reproduce.
  providerSlots: [],
  tags: ['features', 'observability', 'tools'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region reason-sources
function runsAgent(displayName?: string) {
  const loadAttachment = defineTool({
    name: 'load_attachment',
    description: 'Load the files attached to this conversation',
    inputSchema: { type: 'object', properties: {} },
    // The app's words for what a call of this tool does — the ONLY name a person reads.
    ...(displayName !== undefined && { displayName }),
    execute: () =>
      absent({ what: 'an attached data file', checked: ['the files attached to this chat'] }),
  });
  const listRuns = defineTool({
    name: 'list_runs',
    description: 'The runs in the workspace',
    inputSchema: { type: 'object', properties: {} },
    execute: () => [{ id: 'run-1', state: 'draft' }],
  });
  return Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'load_attachment', args: {} },
            { id: 'c2', name: 'list_runs', args: {} },
          ],
        },
        { content: 'One draft run: run-1.' },
      ],
    }),
    model: 'small-model',
  })
    .tool(loadAttachment)
    .tool(listRuns)
    .answerLayer({ standingLine: true })
    .build();
}

async function answerAndSources(question: string, displayName?: string) {
  const agent = runsAgent(displayName);
  const text = (await agent.run({ message: question })) as string;
  const assessment = await agent.assessment();
  // What each reason rests on — the calls its rows name, the answer, or the run.
  const sources = assessment?.reasons.map((r) => ({ reason: r.reason, source: r.source }));
  return { text, standing: assessment?.standing, sources };
}
// #endregion reason-sources

export async function run(input: string): Promise<string> {
  const named = await answerAndSources(input, 'loading the attached data');
  const plain = await answerAndSources(input);

  console.log(named.text);
  console.log(JSON.stringify(named.sources));
  console.log(plain.text);

  // Only the call that found nothing is a source; the clean one is not.
  check(
    JSON.stringify(named.sources) ===
      JSON.stringify([
        {
          reason: 'declared-absent',
          source: { kind: 'calls', calls: [{ toolCallId: 'c1', toolName: 'load_attachment' }] },
        },
      ]),
    'the reason to rest on the absent call only',
  );
  check(
    named.text.endsWith('\n\n---\n\nNot sure — loading the attached data found nothing.'),
    'the line to name the call in the app’s words',
  );
  check(
    plain.text.endsWith('\n\n---\n\nNot sure — a tool said nothing matched.'),
    'no displayName to keep today’s words',
  );
  check(named.standing === plain.standing, 'naming to leave the standing as it was');
  return `${named.standing} · ${named.sources?.[0]?.source.kind}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
