import { describe, expect, it } from 'vitest';
import { Agent, askHuman, defineTool, isPaused } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import { validateCheckpoint, type AgentRunCheckpoint } from '../../../../src/core/runCheckpoint.js';

const QUESTION = 'Keep the synthetic checkpoint request.';
const marker = { spent: true as const };
const stored = () => ({
  version: 1 as const,
  runId: 'synthetic-source-correction-request',
  history: [{ role: 'user' as const, content: QUESTION }],
  lastCompletedIteration: 1,
  originalInput: { message: QUESTION },
  checkpointedAt: 1,
  sourceDeclarationCorrection: { ...marker },
});
function agent(
  options: {
    correction?: boolean;
    fail?: boolean;
    pause?: boolean;
    reactMode?: 'dynamic' | 'dynamic-grouped';
  } = {},
) {
  let calls = 0;
  const provider = mock({
    respond() {
      calls++;
      if ((options.fail || options.pause) && calls === 1)
        return {
          content: '',
          toolCalls: [
            {
              id: 'synthetic-progress',
              name: options.pause ? 'synthetic_checkpoint_pause' : 'synthetic_checkpoint_progress',
              args: {},
            },
          ],
        };
      if (options.fail) throw new Error('Synthetic checkpoint provider failure.');
      return 'Completed synthetic request.';
    },
  });
  const builder = Agent.create({ provider, model: 'mock', reactMode: options.reactMode })
    .tool(
      defineTool({
        name: 'synthetic_checkpoint_lookup',
        description: 'Read an explicitly named synthetic fixture.',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        askOrAssume: { name: { ask: 'Which synthetic fixture?' } },
        execute: () => 'Synthetic fixture.',
      }),
    )
    .tool(
      defineTool({
        name: 'synthetic_checkpoint_progress',
        description: 'Commit one native synthetic iteration.',
        execute: () => 'Synthetic iteration completed.',
      }),
    )
    .tool(
      defineTool({
        name: 'synthetic_checkpoint_pause',
        description: 'Ask a synthetic human question.',
        execute: () => askHuman({ question: 'Continue the synthetic request?' }),
      }),
    );
  const inputs = {
    argumentSources: true,
    ...(options.correction !== false && { declarationCorrection: 'once' as const }),
  };
  return { agent: builder.inputsLayer(inputs).build(), calls: () => calls };
}

describe('source declaration correction checkpoint lifetime', () => {
  it('keeps old checkpoint identity and absence byte-compatible', () => {
    const { sourceDeclarationCorrection: _omitted, ...legacy } = stored();
    expect(validateCheckpoint(legacy)).toBe(legacy);
    expect(validateCheckpoint(legacy)).not.toHaveProperty('sourceDeclarationCorrection');
  });

  it.each(
    [
      null,
      false,
      'spent',
      {},
      { spent: false },
      { spent: 'true' },
      { spent: true, extra: 1 },
      [],
    ].map((value) => ({ value })),
  )('refuses a malformed present finite carrier: $value', ({ value }) => {
    expect(() => validateCheckpoint({ ...stored(), sourceDeclarationCorrection: value })).toThrow(
      /source declaration correction/i,
    );
  });

  it('refuses hidden, inherited and accessor carrier data without invoking a getter', () => {
    let reads = 0;
    const carrierGetter = { ...stored() };
    Object.defineProperty(carrierGetter, 'sourceDeclarationCorrection', {
      enumerable: true,
      get() {
        reads++;
        return marker;
      },
    });
    const spentGetter = Object.defineProperty({}, 'spent', {
      enumerable: true,
      get() {
        reads++;
        return true;
      },
    });
    const hidden = Object.defineProperty({ ...stored() }, 'sourceDeclarationCorrection', {
      value: marker,
      enumerable: false,
    });
    const inherited = Object.assign(
      Object.create({ sourceDeclarationCorrection: marker }),
      (() => {
        const { sourceDeclarationCorrection: _omitted, ...legacy } = stored();
        return legacy;
      })(),
    );
    for (const value of [
      carrierGetter,
      hidden,
      inherited,
      { ...stored(), sourceDeclarationCorrection: spentGetter },
      {
        ...stored(),
        sourceDeclarationCorrection: Object.defineProperty({ spent: true }, 'hidden', { value: 1 }),
      },
      { ...stored(), sourceDeclarationCorrection: Object.create({ spent: true }) },
    ]) {
      expect(() => validateCheckpoint(value)).toThrow(/source declaration correction/i);
    }
    expect(reads).toBe(0);
  });

  it('detaches the one finite carrier at the public validation door', () => {
    const input = stored(),
      checked = validateCheckpoint(input);
    expect(checked).not.toBe(input);
    expect(checked.sourceDeclarationCorrection).toEqual(marker);
    Object.assign(input.sourceDeclarationCorrection, { spent: false });
    expect(checked.sourceDeclarationCorrection).toEqual(marker);
  });

  it('carries a same-request spent marker through JSON, fresh Agent restoration and ordinary checkpoint', async () => {
    const fixture = agent(),
      checkpoint = JSON.parse(JSON.stringify(stored())) as AgentRunCheckpoint;
    await expect(fixture.agent.resumeOnError(checkpoint)).resolves.toBe(
      'Completed synthetic request.',
    );
    expect(fixture.calls()).toBe(1);
    expect(fixture.agent.checkpoint()?.sourceDeclarationCorrection).toEqual(marker);
    const fresh = agent();
    await fresh.agent.resumeOnError(JSON.parse(JSON.stringify(fixture.agent.checkpoint())));
    expect(fresh.agent.checkpoint()?.sourceDeclarationCorrection).toEqual(marker);
    await fresh.agent.run({ message: 'A genuinely new synthetic request.' });
    expect(fresh.agent.checkpoint()).not.toHaveProperty('sourceDeclarationCorrection');
  });

  it('refuses the same active spent request on an agent without correction before calling its provider', async () => {
    const fixture = agent({ correction: false });
    await expect(fixture.agent.resumeOnError(stored())).rejects.toThrow(
      /source declaration correction/i,
    );
    expect(fixture.calls()).toBe(0);
    await expect(
      fixture.agent.run({ message: 'New human turn.', continueFrom: stored() }),
    ).resolves.toBe('Completed synthetic request.');
    expect(fixture.agent.checkpoint()).not.toHaveProperty('sourceDeclarationCorrection');
  });

  it.each(['dynamic', 'dynamic-grouped'] as const)(
    '%s carries the same finite spent marker through the native crash checkpoint writer',
    async (reactMode) => {
      const fixture = agent({ fail: true, reactMode });
      const error = await fixture.agent.resumeOnError(stored()).catch((error) => error);
      expect(fixture.calls()).toBe(2);
      expect(error.code).toBe('ERR_RUN_CHECKPOINT');
      expect(error.checkpoint?.sourceDeclarationCorrection).toEqual(marker);
      expect(JSON.parse(JSON.stringify(error.checkpoint)).sourceDeclarationCorrection).toEqual(
        marker,
      );
    },
  );

  it.each(['dynamic', 'dynamic-grouped'] as const)(
    '%s native executing pause preserves spent state and rejects an incompatible fresh Agent before dispatch',
    async (reactMode) => {
      const fixture = agent({ pause: true, reactMode }),
        paused = await fixture.agent.resumeOnError(stored());
      expect(isPaused(paused)).toBe(true);
      if (!isPaused(paused)) throw new Error('Expected an actual native synthetic human pause.');
      const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
      expect(checkpoint.sharedState.sourceDeclarationCorrectionSpent).toBe(true);
      const incompatible = agent({ correction: false, reactMode });
      await expect(incompatible.agent.resume(checkpoint, 'Continue')).rejects.toThrow(
        /source declaration correction/i,
      );
      expect(incompatible.calls()).toBe(0);
      const recreated = agent({ reactMode });
      await expect(
        recreated.agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), 'Continue'),
      ).resolves.toBe('Completed synthetic request.');
      expect(recreated.agent.checkpoint()?.sourceDeclarationCorrection).toEqual(marker);
      await recreated.agent.followUp('A new synthetic human request.');
      expect(recreated.agent.checkpoint()).not.toHaveProperty('sourceDeclarationCorrection');
    },
  );

  it('an aborted same-request entry cannot leave its pending marker on the next fresh run', async () => {
    const fixture = agent(),
      controller = new AbortController();
    controller.abort(new Error('Synthetic caller cancelled before seed.'));
    await expect(
      fixture.agent.resumeOnError(stored(), { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fixture.calls()).toBe(0);
    await fixture.agent.run({ message: 'A fresh request after cancellation.' });
    expect(fixture.agent.checkpoint()).not.toHaveProperty('sourceDeclarationCorrection');
  });

  it('new human continuation resets correction independently of evidence-recovery state', async () => {
    const fixture = agent(),
      prior = { ...stored(), evidenceRecovery: { revisionSpent: true as const } };
    await fixture.agent.run({ message: 'Next synthetic turn.', continueFrom: prior });
    expect(fixture.agent.checkpoint()).not.toHaveProperty('sourceDeclarationCorrection');
    expect(fixture.agent.checkpoint()).not.toHaveProperty('evidenceRecovery');
  });
});
