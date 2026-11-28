import { describe, expect, it } from 'vitest';
import { Agent, coverage, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, buildAccountFromView } from '../../src/answer-account/account.js';
import { bundleView } from '../../src/answer-account/bundleView.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { validateDeclarations } from '../../src/answer-account/declarations.js';
import type { AnswerAccountDeclarations } from '../../src/answer-account/types.js';
import type { AnswerAccountRecorder } from '../../src/recorders/observability/answerAccount/recorder.js';
import { recordAnswerAccountWithTools } from '../../src/answer-account/recordToolEvidence.js';

const TOOL = 'lookup_rows';
const BODY = 'original tool body sentinel';
const ticket = {
  ref: 'art_0123456789abcdefghijkl',
  kind: 'dataset/rows',
  rows: 12,
  sourceField: 'rows',
};
const declarations = (rowsAt: string): AnswerAccountDeclarations => ({
  tools: { [TOOL]: { rowsAt } },
});

function runnerFor(result: unknown, assume = false) {
  return Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'lookup-1', name: TOOL, args: {} }] },
        { content: 'The lookup finished.' },
        { content: 'The earlier lookup is in view.' },
      ],
    }),
  })
    .tool(
      defineTool({
        name: TOOL,
        description: 'Read fixture rows.',
        inputSchema: {
          type: 'object',
          ...(assume && { required: ['window'], properties: { window: { type: 'string' } } }),
        },
        ...(assume && { askOrAssume: { window: { assume: '2h' } } }),
        execute: () => result,
      }),
    )
    .build();
}

async function recordedResult(result: unknown, recall = false) {
  const runner = runnerFor(result, recall);
  if (recall) await runner.run('Look up rows.');
  const observed = recordAnswerAccountWithTools(runner, 256 * 1024);
  if (recall) await runner.followUp('What did the earlier lookup return?');
  else await runner.run('Look up rows.');
  observed.recording.stop();
  return { observed, runner };
}

function expectParity(observed: AnswerAccountRecorder, declared: AnswerAccountDeclarations) {
  const recording = observed.recording.toRecording();
  const whole = accountForAnswer(recording, declared);
  const bundle = observed.toSnapshot()!;
  const view = bundleView(bundle);
  expect(bundle.gaps).toEqual([]);
  expect(view).toBeDefined();
  const fromBundle = buildAccountFromView(view!, validateDeclarations(declared));
  expect(JSON.stringify(fromBundle)).toBe(JSON.stringify(whole));
  expect(showLeaves(fromBundle, recording, declared)).toEqual(
    showLeaves(whole, recording, declared),
  );
  expect(JSON.stringify(bundle)).not.toContain(BODY);
  return whole;
}

describe('in-memory tool-result and recall evidence', () => {
  it('preserves earlier result coordinates and the original tool prefix under a new declaration', async () => {
    const { observed, runner } = await recordedResult({ rows: [], other: [{ text: BODY }] }, true);
    const history = runner.getLastSnapshot()?.sharedState.history as readonly {
      role: string;
      content: string;
      toolChars?: number;
    }[];
    const committed = history.find((message) => message.role === 'tool')!;
    expect(committed.toolChars).toBeGreaterThan(0);
    expect(committed.content.length).toBeGreaterThan(committed.toolChars!);
    const first = expectParity(observed, declarations('rows')).facts.inView;
    const changed = expectParity(observed, declarations('other')).facts.inView;
    expect(first).toMatchObject([{ emptiness: 'undeclared-empty', rows: 0, distance: 1 }]);
    expect(changed).toMatchObject([{ emptiness: 'non-empty', rows: 1, distance: 1 }]);
    expect(changed[0]?.pointers).toEqual(first[0]?.pointers);
  });

  it.each([
    {
      label: 'present scalar',
      result: { rows: BODY, datasets: { rows: ticket } },
      rows: undefined,
    },
    {
      label: 'present array',
      result: { rows: [{ value: BODY }], datasets: { rows: ticket } },
      rows: 1,
    },
    { label: 'absent', result: { datasets: { rows: ticket } }, rows: 12 },
  ])('resolves a $label selected key next to the same-key ticket', async ({ result, rows }) => {
    const { observed } = await recordedResult(result);
    const calls = expectParity(observed, declarations('rows')).facts.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.rows).toBe(rows);
    expect(calls[0]?.emptiness).toBe(rows === undefined ? 'unknown' : 'non-empty');
  });

  it('keeps a selected late key within the shape budget and marks a wider result unavailable', async () => {
    function wide(keys: number) {
      return Object.fromEntries(
        Array.from({ length: keys }, (_, i) => [`column${i}`, i === 63 ? [{ value: BODY }] : BODY]),
      );
    }
    const kept = (await recordedResult(wide(64))).observed;
    expect(expectParity(kept, declarations('column63')).facts.calls[0]?.rows).toBe(1);
    const overflow = (await recordedResult(wide(65))).observed;
    expect(
      accountForAnswer(overflow.recording.toRecording(), declarations('column63')).facts.calls[0]
        ?.rows,
    ).toBe(1);
    const bundle = overflow.toSnapshot()!;
    expect(bundle.gaps).toContain('tool-result-key-limit');
    expect(bundleView(bundle)).toBeUndefined();
    expect(expectParity(kept, declarations('column64')).facts.calls[0]?.emptiness).toBe('unknown');
    if (process.env.EXPL1_MEASURE === '1') {
      const retained = kept.toSnapshot()!;
      process.stdout.write(
        JSON.stringify({
          admittedKeys: 64,
          boundedBundleBytes: Buffer.byteLength(JSON.stringify(retained)),
          ordinaryRecordingBytes: Buffer.byteLength(JSON.stringify(kept.recording.toRecording())),
          overflowKeys: 65,
          overflowGaps: bundle.gaps,
        }) + '\n',
      );
    }
    expect(JSON.stringify(bundle)).not.toContain(BODY);
  });

  it('keeps coverage results outside the plain-result projection', async () => {
    const { observed } = await recordedResult(
      coverage({ rows: [{ text: BODY }] }, { checked: [{ what: 'Offline fixture coverage' }] }),
    );
    const bundle = observed.toSnapshot()!;
    expect(bundle.gaps).toContain('tool-results');
    expect(bundleView(bundle)).toBeUndefined();
    expect(JSON.stringify(bundle)).not.toContain(BODY);
  });
});
