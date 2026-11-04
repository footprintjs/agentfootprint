import { expect, it } from 'vitest';
import {
  createRunLifecycle,
  flowChart,
  interrupt,
  type CombinedRecorder,
  type FlowchartCheckpoint,
  type RunEntry,
  type RunSetup,
} from 'footprintjs';
import { createTypedScopeFactory } from 'footprintjs/advanced';
import { EventDispatcher } from '../events/dispatcher.js';
import { resumeRedactionOf } from '../core/agent/run/resumeRedaction.js';
import { createRunRedaction, markPrivateFields, type RunRedaction } from './runRedaction.js';
import { addPrivateRecordFields } from './privateFields.js';
import { privateResumeOf } from './privateCheckpoint.js';

for (const mode of ['same', 'fresh'] as const)
  it(`actual native ${mode.toUpperCase()} resume keeps private computation out of hooks and snapshot`, async () => {
    const secret = 'private-native-mode-fixture';
    const ran: unknown[] = [],
      hooks: unknown[] = [];
    const chart = flowChart(
      'Private native resume',
      (scope) => {
        markPrivateFields(scope, [{ root: 'argumentAsk', path: 'progress.0.answer' }]);
        scope.$setValue('argumentAsk', { progress: [{ answer: secret }] });
        scope.$setValue('authorMarked', secret + '-author', true);
        interrupt(scope, { reason: 'Continue public operation?' });
        ran.push(scope.$getValue('argumentAsk'));
        return 'public-result';
      },
      'private-native-resume',
    ).build();
    const base = createTypedScopeFactory();
    const lifecycle = createRunLifecycle(chart, {
      runnerId: 'private-native-fixture',
      executorOptions: {
        scopeFactory(context, stage, readOnly, env) {
          const scope = base(context, stage, readOnly, env);
          const entry = lifecycle.forScope(scope).read(slot);
          if (entry.present) entry.value.bindScope(scope, context);
          return scope;
        },
      },
    });
    const slot = lifecycle.slot<RunRedaction>('leg');
    const recorder = {
      id: 'native-private-hooks',
      ...Object.fromEntries(
        [
          'onPause',
          'onResume',
          'onWrite',
          'onRead',
          'onCommit',
          'onStageExecuted',
          'onEmit',
          'onRunStart',
          'onRunEnd',
        ].map((name) => [name, (value: unknown) => hooks.push({ name, value })]),
      ),
    } as CombinedRecorder;
    async function execute(entry: RunEntry, checkpoint?: FlowchartCheckpoint) {
      return lifecycle.withRun(async (run) => {
        const redaction = createRunRedaction({
          policy: checkpoint === undefined ? undefined : resumeRedactionOf(checkpoint, []),
          privateFields:
            checkpoint === undefined
              ? addPrivateRecordFields(undefined, [])
              : privateResumeOf(checkpoint).privateFields,
          recordMarks:
            checkpoint === undefined ? undefined : privateResumeOf(checkpoint).recordMarks,
          dispatcher: new EventDispatcher(),
          getRunContext: () => {
            const origin = run.origin;
            if (origin === undefined) throw new Error('No native origin');
            return { runId: origin.runId, runStartMs: origin.startedAtMs, compositionPath: [] };
          },
        });
        run.set(slot, redaction);
        const setup: RunSetup = {
          redaction: redaction.recordPolicy,
          attachments: [...redaction.recorders, recorder].map((item) => ({ recorder: item })),
        };
        return run.execute(entry, setup);
      });
    }
    const paused = (await execute({ kind: 'run' })) as { checkpoint?: FlowchartCheckpoint };
    const continuation = lifecycle.continuation();
    expect(lifecycle.view()?.isPaused()).toBe(true);
    if (continuation === undefined) throw new Error('No native continuation');
    const checkpoint = structuredClone(continuation.checkpoint());
    expect(checkpoint.sharedState.authorMarked).toBe(secret + '-author');
    expect(JSON.stringify(checkpoint)).toContain(secret);
    expect(resumeRedactionOf(checkpoint, [])).toBeUndefined();
    const entry: RunEntry =
      mode === 'same'
        ? { kind: 'resume', mode, continuation, input: 'continue' }
        : { kind: 'resume', mode, checkpoint, input: 'continue' };
    await execute(entry, checkpoint);
    expect(paused).toBeDefined();
    expect(ran).toEqual([{ progress: [{ answer: secret }] }]);
    expect(JSON.stringify(hooks).includes(secret)).toBe(false);
    const view = lifecycle.view();
    if (view === undefined) throw new Error('No native view');
    const snapshot = view.snapshot({ redact: true });
    expect(JSON.stringify(snapshot).includes(secret)).toBe(false);
    expect(snapshot).not.toHaveProperty('initialState');
  });
