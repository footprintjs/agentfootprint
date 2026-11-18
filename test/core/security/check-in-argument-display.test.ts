import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  CheckInRecorder,
  allow,
  checkInApproved,
  defineTool,
  isCheckInPause,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../../src/observe.js';
import {
  argsRedactedBy,
  SHOWN_ARGS,
  shownFieldsOf,
  type ShownArgs,
} from '../../../src/core/toolShownArgs.js';
import { argsShownOf } from '../../../src/ag-ui/shownArgs.js';
import { runAsAgUi } from '../../ag-ui/helpers.js';

const privateLabel = 'inert-sample-value';
const callArgs = { label: privateLabel, count: 3 };
const mask = { label: 'REDACTED', count: 'REDACTED' };
type Args = Readonly<Record<string, unknown>>;

function previewAgent(
  display: ShownArgs | undefined,
  {
    rewrite = false,
    proposed = callArgs,
    toolArgValidation = 'enforce',
  }: { rewrite?: boolean; proposed?: Args; toolArgValidation?: 'warn' | 'enforce' } = {},
) {
  const recorder = new CheckInRecorder();
  const execute = vi.fn((_args: Args) => 'Preview complete.');
  const tool = defineTool<Args, string>({
    name: 'preview',
    description: 'Preview a sample.',
    inputSchema: {
      type: 'object',
      properties: { label: { type: 'string' }, count: { type: 'number' } },
    },
    checkIn: 'always',
    execute,
  });
  const builder = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'preview-call', name: 'preview', args: proposed }] },
        'Preview complete.',
      ],
    }),
    model: 'mock',
    toolArgValidation,
  })
    .tool(display === undefined ? tool : Object.assign(tool, { [SHOWN_ARGS]: display }))
    .answerLayer();
  if (rewrite)
    builder.toolMiddleware({
      name: 'adjust-count',
      onToolCall: ({ args }) => allow({ ...args, count: 4 }, 'Set the preview count.'),
    });
  const agent = builder.build();
  agent.attach(recorder);
  return { agent, recorder, execute };
}

class UnsupportedDisplay {
  readonly kind = 'preview';
}

const unsupportedDisplays = [
  ['string', 'preview'],
  ['array', ['preview']],
  ['null', null],
  ['class instance', new UnsupportedDisplay()],
] as const;

describe('approval display', () => {
  it('retains the protected display for an unrecognized argument container', () => {
    const project = vi.fn(() => ({}));
    const tool = { [SHOWN_ARGS]: project };

    expect(shownFieldsOf(tool, [] as unknown as Args)).toEqual({ shownArgs: {}, hiddenArgs: [] });
    expect(shownFieldsOf(tool, [3] as unknown as Args)).toEqual({
      shownArgs: { 0: 'REDACTED' },
      hiddenArgs: ['0'],
    });
    expect(project).not.toHaveBeenCalled();
  });

  it.each(unsupportedDisplays)(
    'masks an unsupported %s at the wire boundary',
    (_kind, shownArgs) => {
      const custom = vi.fn(() => ({ unexpected: true }));
      const view = argsShownOf(
        { args: callArgs, shownArgs, hiddenArgs: ['label'] },
        'preview-call',
        custom,
      );
      expect(view.args).toEqual(mask);
      expect(view.address.hiddenArgs).toEqual(['label', 'count']);
      expect(custom).not.toHaveBeenCalled();
    },
  );

  it.each(unsupportedDisplays)(
    'masks an unsupported %s throughout a real pause',
    async (_kind, output) => {
      const { agent, recorder, execute } = previewAgent(() => output as unknown as Args);
      const started = await runAsAgUi(agent, { message: 'Preview the sample.' });
      const pause = started.out;
      if (!isCheckInPause(pause)) throw new Error('Expected a check-in pause.');

      expect(execute).not.toHaveBeenCalled();
      expect(pause.checkIn.args).toEqual(mask);
      expect(pause.checkIn.hiddenArgs).toEqual(['label', 'count']);
      expect(pause.checkIn.evidence.willDo).toContain(
        'Values hidden from this view: `label`, `count`.',
      );
      expect(started.events.find((event) => event.type === 'TOOL_CALL_ARGS')).toMatchObject({
        delta: JSON.stringify(mask),
      });
      expect(
        JSON.stringify([started.events, recorder.getRequests(), pause.checkIn]).includes(
          privateLabel,
        ),
      ).toBe(false);
    },
  );

  it('keeps the hidden-view approval on the decision and runs the bound call', async () => {
    const { agent, recorder, execute } = previewAgent(argsRedactedBy({ keys: ['label'] }));
    const recording = recordRun(agent);
    const custom = vi.fn(() => ({ unexpected: true }));
    try {
      const started = await runAsAgUi(
        agent,
        { message: 'Preview the sample.' },
        { serializer: { toolArguments: custom } },
      );
      const pause = started.out;
      if (!isCheckInPause(pause)) throw new Error('Expected a check-in pause.');

      expect(pause.checkIn.args).toEqual({ label: 'REDACTED', count: 3 });
      expect(pause.checkIn.hiddenArgs).toEqual(['label']);
      expect(pause.checkIn.evidence.willDo).toContain('Values hidden from this view: `label`.');
      expect(execute).not.toHaveBeenCalled();
      expect(started.events.find((event) => event.type === 'TOOL_CALL_ARGS')).toMatchObject({
        delta: '{"label":"REDACTED","count":3}',
      });
      expect(custom).not.toHaveBeenCalled();

      const resumed = await runAsAgUi(agent, undefined, {
        serializer: { resume: started.translation.suspension() },
        resume: {
          checkpoint: pause.checkpoint,
          answer: checkInApproved({ request: pause.checkIn, by: 'reviewer' }),
        },
      });
      expect(resumed.error).toBeUndefined();
      expect(resumed.out).toBe('Preview complete.');
      expect(execute).toHaveBeenCalledWith(callArgs, expect.anything());
      const decision = resumed.served.find(
        (event) => event.type === 'agentfootprint.checkin.decision',
      );
      expect(decision?.payload).toMatchObject({ approved: true, hiddenArgs: ['label'] });
      expect(recorder.getDecisions()).toMatchObject([{ approved: true, hiddenArgs: ['label'] }]);
      const account = accountForAnswer(recording.toRecording());
      expect(account.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify([account, resumed.out])).not.toMatch(/reviewed by a person/i);
      expect(
        JSON.stringify([started.events, resumed.events, recorder.getDecisions()]).includes(
          privateLabel,
        ),
      ).toBe(false);
    } finally {
      recording.stop();
    }
  });

  it.each([true, false])(
    'refuses a scalar before check-in (protected: %s)',
    async (protectedView) => {
      const sample = 'plain-preview-sample';
      const display: ShownArgs | undefined = protectedView ? (args) => args : undefined;
      const { agent, recorder, execute } = previewAgent(display, {
        proposed: sample as unknown as Args,
        toolArgValidation: 'warn',
      });
      const started = await runAsAgUi(agent, { message: 'Preview the sample.' });

      expect(started.error === undefined).toBe(true);
      expect(isCheckInPause(started.out)).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(recorder.getRequests()).toHaveLength(0);
      expect(recorder.getDecisions()).toHaveLength(0);
      expect(started.served.some((event) => event.type === 'agentfootprint.pause.request')).toBe(
        false,
      );
      expect(
        started.served.find((event) => event.type === 'agentfootprint.validation.args_invalid'),
      ).toMatchObject({ payload: { enforced: false } });
      const toolEnd = started.served.find(
        (event) => event.type === 'agentfootprint.stream.tool_end',
      );
      const refusal =
        toolEnd?.type === 'agentfootprint.stream.tool_end' ? toolEnd.payload.result : undefined;
      expect(typeof refusal === 'string' && refusal.includes('no approval could be bound')).toBe(
        true,
      );
      expect(typeof refusal === 'string' && refusal.includes(sample)).toBe(false);

      if (protectedView) {
        expect(started.events.find((event) => event.type === 'TOOL_CALL_ARGS')).toMatchObject({
          delta: '{"arguments":"REDACTED"}',
        });
        expect(started.events.find((event) => event.type === 'TOOL_CALL_START')).toMatchObject({
          metadata: { agentfootprint: { hiddenArgs: ['arguments'] } },
        });
        expect(JSON.stringify(started.events).includes(sample)).toBe(false);
      }
    },
  );

  it('keeps the enforcing schema refusal before a scalar check-in', async () => {
    const { agent, execute } = previewAgent((args) => args, {
      proposed: 'plain-preview-sample' as unknown as Args,
    });
    const started = await runAsAgUi(agent, { message: 'Preview the sample.' });

    expect(isCheckInPause(started.out)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(
      started.served.find((event) => event.type === 'agentfootprint.validation.args_invalid'),
    ).toMatchObject({ payload: { enforced: true } });
  });

  it.each(['', 0, true, false])('masks a present scalar with a fixed name', (scalar) => {
    const view = argsShownOf({ args: scalar, hiddenArgs: [] }, 'preview-call');
    expect(view).toMatchObject({
      args: { arguments: 'REDACTED' },
      address: { hiddenArgs: ['arguments'] },
    });
  });

  it.each([null, undefined, []])(
    'keeps the protected empty display for absent or empty arguments',
    (empty) => {
      expect(argsShownOf({ args: empty, hiddenArgs: [] }, 'preview-call')).toEqual({
        args: {},
        address: { toolCallId: undefined },
      });
    },
  );

  it('uses conservative proposal display when middleware can update the call', async () => {
    const before = argsRedactedBy({ keys: ['label'] });
    const { agent } = previewAgent(before, { rewrite: true });
    const started = await runAsAgUi(agent, { message: 'Preview the sample.' });
    if (!isCheckInPause(started.out)) throw new Error('Expected a check-in pause.');

    expect(started.events.find((event) => event.type === 'TOOL_CALL_ARGS')).toMatchObject({
      delta: JSON.stringify(mask),
    });
    expect(started.out.checkIn.args).toEqual({ label: 'REDACTED', count: 4 });
    expect(started.out.checkIn.hiddenArgs).toEqual(['label']);
  });
});
