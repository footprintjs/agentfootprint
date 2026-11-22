import { expect, it } from 'vitest';
import { absent, Agent, coverage, defineTool, type AgentOptions } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';

const ANSWER = 'I reviewed the available records.';

function lookup(name: string, displayName: string, execute: () => unknown) {
  return defineTool({
    name,
    displayName,
    inputSchema: { type: 'object', properties: {} },
    description: 'Read a fixture record.',
    execute,
  });
}

async function runFixture(tools: ReturnType<typeof lookup>[], redact?: AgentOptions['redact']) {
  const toolCalls = tools.map((tool, position) => ({
    id: `lookup-${position}`,
    name: tool.schema.name,
    args: {},
  }));
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls }, ANSWER] }),
    model: 'mock',
    ...(redact === undefined ? {} : { redact }),
  })
    .tools(tools)
    .build();
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run({ message: 'Check the fixture records.' });
    const live = await agent.assessment();
    if (live === undefined) throw new Error('Expected the fixture to return an assessment.');
    const saved = assessAnswer(JSON.parse(JSON.stringify(recorder.toRecording())));
    expect(saved).toEqual(live);
    return { answer, live };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it('attributes the same advice to each declaring tool when it fits the warning', async () => {
  const advice = 'Try backup records';
  const missing = () => absent({ what: 'the item', checked: ['Index'], tryInstead: advice });
  const { answer, live } = await runFixture([
    lookup('live_index', 'Live index', missing),
    lookup('archive_index', 'Archive index', missing),
  ]);

  expect(live.reasons.find(({ reason }) => reason === 'declared-absent')?.detail?.toolSays).toEqual(
    {
      entries: [
        { kind: 'tryInstead', text: advice, toolName: 'live_index' },
        { kind: 'tryInstead', text: advice, toolName: 'archive_index' },
      ],
      omitted: 0,
    },
  );
  expect(answer).toContain('Live index suggested “Try backup records”');
  expect(answer).toContain('Archive index suggested “Try backup records”');
});

it('counts advice just over the recording cutoff without quoting it', async () => {
  const read = (tryInstead: string) =>
    runFixture([
      lookup('archive', 'Archive lookup', () =>
        absent({ what: 'the item', checked: ['Index'], tryInstead }),
      ),
    ]);
  const short = await read('A'.repeat(320));
  const long = await read('A'.repeat(321));
  const words = ({ live }: Awaited<ReturnType<typeof runFixture>>) =>
    live.reasons.find(({ reason }) => reason === 'declared-absent')?.detail?.toolSays;
  const fragment = `${'A'.repeat(79)}…`;

  expect(words(short)).toEqual({
    entries: [{ kind: 'tryInstead', text: fragment, toolName: 'archive' }],
    omitted: 0,
  });
  expect(short.answer).toContain(`suggested “${fragment}”`);
  expect(words(long)).toEqual({ entries: [], omitted: 1 });
  expect(long.answer).toContain('1 more in the run record');
  expect(long.answer).not.toContain('AAAA');
});

it('keeps the visible gap when a sibling notChecked field is redacted', async () => {
  const read = (hidden: string) =>
    runFixture(
      [
        lookup('archive', 'Archive lookup', () =>
          coverage([{ available: true }], {
            checked: ['Current stock'],
            notChecked: [
              { what: `Private record field ${hidden}`, short: hidden },
              { what: 'Returns inventory from the archive', short: 'Returns inventory' },
            ],
          }),
        ),
      ],
      { fields: { coverageDeclared: ['0.notChecked.0.what'] } },
    );
  const first = await read('hidden_field_alpha');
  const second = await read('hidden_field_beta');

  expect(first.answer).toEqual(second.answer);
  for (const { answer, live } of [first, second]) {
    expect(answer).toContain('did not check “Returns inventory”');
    expect(answer).not.toContain('hidden_field_');
    expect(live.reasons.find(({ reason }) => reason === 'coverage-gap')?.detail?.toolSays).toEqual({
      entries: [{ kind: 'notChecked', text: 'Returns inventory', toolName: 'archive' }],
      omitted: 0,
    });
  }
});

it('keeps a selected oversized suggestion and its omission out of both readers', async () => {
  const read = (tryInstead?: string, redact?: AgentOptions['redact']) =>
    runFixture(
      [
        lookup('archive', 'Archive lookup', () =>
          absent({
            what: 'the item',
            checked: ['Index'],
            ...(tryInstead === undefined ? {} : { tryInstead }),
          }),
        ),
      ],
      redact,
    );
  const visible = await read('A'.repeat(321));
  const selected = await read('A'.repeat(321), {
    fields: { coverageDeclared: ['0.tryInstead'] },
  });
  const missing = await read();

  expect(visible.answer).toContain('1 more in the run record');
  expect(selected.answer).toBe(missing.answer);
  expect(
    selected.live.reasons.find(({ reason }) => reason === 'declared-absent')?.detail,
  ).toBeUndefined();
});
