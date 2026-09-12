import { describe, expect, it, vi } from 'vitest';
import {
  executeAnswerValidation,
  resolveAnswerValidation,
} from '../../src/answer-validation/validate.js';
import { AnswerValidationError } from '../../src/answer-validation/types.js';
import { inMemoryArtifacts } from '../../src/artifacts/inMemoryArtifacts.js';

const scope = { conversationId: 'synthetic-validation' };
const parser = { parse: (value: unknown) => value };
const pass = { id: 'measured-total', disposition: 'checked-pass' as const };

describe('contract: explicit answer checks', () => {
  it('returns exactly the frozen detached schema transformation it validated', async () => {
    const transformed = { total: 42, unit: 'items', nested: { source: 'fixture' } };
    let observed: unknown;
    const config = resolveAnswerValidation({
      id: 'commerce',
      version: '1',
      validate(candidate) {
        observed = candidate;
        expect(Object.isFrozen(candidate)).toBe(true);
        expect(Object.isFrozen((candidate as typeof transformed).nested)).toBe(true);
        return { checks: [pass] };
      },
    });
    const result = await executeAnswerValidation(
      '{"total":"42"}',
      { parse: () => transformed },
      config,
      undefined,
      scope,
    );
    transformed.nested.source = 'changed';
    expect(observed).toEqual({ total: 42, unit: 'items', nested: { source: 'fixture' } });
    expect(result.content).toBe('{"total":42,"unit":"items","nested":{"source":"fixture"}}');
    expect(result.report).toMatchObject({
      status: 'passed',
      checked: 1,
      failed: 0,
      schemaAccepted: true,
      mode: 'enforce',
    });
    expect(result.report.candidateDigest).toMatch(/^sha-256:[a-f0-9]{64}$/);
  });

  it.each([
    {
      checks: [pass, { id: 'optional', disposition: 'not-applicable' }],
      status: 'passed',
      checked: 1,
    },
    { checks: [{ id: 'wrong', disposition: 'checked-fail' }], status: 'failed', checked: 1 },
    {
      checks: [pass, { id: 'missing', disposition: 'unreachable' }],
      status: 'unverified',
      checked: 1,
    },
    {
      checks: [{ id: 'optional', disposition: 'not-applicable' }],
      status: 'unverified',
      checked: 0,
    },
    { checks: [], status: 'unverified', checked: 0 },
  ])(
    'derives $status from the declared checks without treating absence as a pass',
    async ({ checks, status, checked }) => {
      const config = resolveAnswerValidation({
        id: 'build-jobs',
        version: '1',
        validate: () => ({ checks } as never),
      });
      const result = await executeAnswerValidation(
        '{"outcome":"success"}',
        parser,
        config,
        undefined,
        scope,
      );
      expect(result.report).toMatchObject({ status, checked });
      expect(result.content !== undefined).toBe(status === 'passed');
    },
  );

  it('observe records a contradiction while returning the canonical accepted candidate', async () => {
    const config = resolveAnswerValidation({
      id: 'commerce',
      version: '2',
      mode: 'observe',
      validate: () => ({
        checks: [{ id: 'sum', disposition: 'checked-fail', reason: 'The observed sum differs.' }],
      }),
    });
    const result = await executeAnswerValidation('{ "sum": 21 }', parser, config, undefined, scope);
    expect(result.report).toMatchObject({
      status: 'failed',
      failed: 1,
      checked: 1,
      mode: 'observe',
    });
    expect(result.content).toBe('{"sum":21}');
  });

  it('schema failure never invokes the validator and observe keeps the original text', async () => {
    const validate = vi.fn(() => ({ checks: [pass] }));
    const config = resolveAnswerValidation({
      id: 'schema',
      version: '1',
      mode: 'observe',
      validate,
    });
    const result = await executeAnswerValidation('not JSON', parser, config, undefined, scope);
    expect(validate).not.toHaveBeenCalled();
    expect(result.report).toMatchObject({
      status: 'unverified',
      schemaAccepted: false,
      checked: 0,
    });
    expect(result.content).toBe('not JSON');
  });

  it('observe does not mark non-JSON parser transformations as an accepted canonical schema', async () => {
    const validate = vi.fn(() => ({ checks: [pass] }));
    const config = resolveAnswerValidation({
      id: 'date-transform',
      version: '1',
      mode: 'observe',
      validate,
    });
    const result = await executeAnswerValidation(
      '{}',
      { parse: () => new Date(0) },
      config,
      undefined,
      scope,
    );
    expect(validate).not.toHaveBeenCalled();
    expect(result.report).toMatchObject({
      status: 'unverified',
      schemaAccepted: false,
      reason: 'non-json-candidate',
    });
    expect(result.content).toBe('{}');
  });

  it.each([
    new Date(),
    NaN,
    Infinity,
    -0,
    undefined,
    { fn() {} },
    [undefined],
    new Map(),
    { value: 1n },
  ])('refuses non-lossless JSON parser output %#', async (value) => {
    const validate = vi.fn(() => ({ checks: [pass] }));
    const config = resolveAnswerValidation({ id: 'json-only', version: '1', validate });
    const result = await executeAnswerValidation(
      '{}',
      { parse: () => value },
      config,
      undefined,
      scope,
    );
    expect(validate).not.toHaveBeenCalled();
    expect(result.report.status).toBe('unverified');
    expect(result.content).toBeUndefined();
  });

  it('rejects getters, sparse arrays, cycles and extra array fields without invoking accessors', async () => {
    const getter = vi.fn(() => 1);
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const decorated = Object.assign([], { '4294967295': 1 });
    for (const value of [accessor, cycle, new Array(2), decorated]) {
      const config = resolveAnswerValidation({
        id: 'safe-json',
        version: '1',
        validate: () => ({ checks: [pass] }),
      });
      expect(
        (await executeAnswerValidation('{}', { parse: () => value }, config, undefined, scope))
          .report.status,
      ).toBe('unverified');
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('bounds UTF-8 candidate bytes and returned checks rather than truncating them', async () => {
    const validate = vi.fn(() => ({ checks: [pass] }));
    const config = resolveAnswerValidation({
      id: 'bounds',
      version: '1',
      limits: { maxCandidateBytes: 8 },
      validate,
    });
    expect(
      (await executeAnswerValidation('"😀😀"', parser, config, undefined, scope)).report.status,
    ).toBe('unverified');
    expect(validate).not.toHaveBeenCalled();
    const many = resolveAnswerValidation({
      id: 'checks',
      version: '1',
      limits: { maxChecks: 1 },
      validate: () => ({ checks: [pass, { ...pass, id: 'second' }] }),
    });
    expect(
      (await executeAnswerValidation('{}', parser, many, undefined, scope)).report,
    ).toMatchObject({ status: 'unverified', checked: 0, checks: [] });
  });

  it.each([
    null,
    { checks: 'pass' },
    { checks: [pass, pass] },
    { checks: [{ id: 'x', disposition: 'green' }] },
    { checks: [pass], content: 'replacement' },
  ])('malformed callback result %# cannot pass', async (result) => {
    const config = resolveAnswerValidation({
      id: 'malformed',
      version: '1',
      validate: () => result as never,
    });
    expect(
      (await executeAnswerValidation('{}', parser, config, undefined, scope)).report,
    ).toMatchObject({ status: 'unverified', checked: 0 });
  });

  it('callback exceptions are unverified without echoing exception contents', async () => {
    const config = resolveAnswerValidation({
      id: 'throws',
      version: '1',
      validate() {
        throw new Error('PRIVATE_SOURCE_PAYLOAD');
      },
    });
    const result = await executeAnswerValidation('{}', parser, config, undefined, scope);
    expect(result.report.status).toBe('unverified');
    expect(JSON.stringify(result.report)).not.toContain('PRIVATE_SOURCE_PAYLOAD');
    const error = new AnswerValidationError(result.report);
    expect(error.report).toEqual(result.report);
    expect(error.message).not.toContain('PRIVATE_SOURCE_PAYLOAD');
  });

  it('a deadline returns unverified, aborts the callback signal and closes retained reader capabilities', async () => {
    const get = vi.fn();
    let reader:
      | Parameters<Parameters<typeof resolveAnswerValidation>[0]['validate']>[1]
      | undefined;
    const config = resolveAnswerValidation({
      id: 'deadline',
      version: '1',
      limits: { timeoutMs: 20 },
      validate: async (_value, context) => {
        reader = context;
        return new Promise(() => {});
      },
    });
    const result = await executeAnswerValidation(
      '{}',
      parser,
      config,
      { ...inMemoryArtifacts(), get },
      scope,
    );
    expect(result.report).toMatchObject({ status: 'unverified', reason: 'timeout', checked: 0 });
    expect(reader?.signal.aborted).toBe(true);
    expect(
      await reader!.artifacts.resolve('art_aaaaaaaaaaaaaaaaaaaaaa', { kind: 'dataset/rows' }),
    ).toMatchObject({ ok: false, reason: 'closed' });
    expect(get).not.toHaveBeenCalled();
  });

  it('an already aborted run performs no parse or validation work', async () => {
    const controller = new AbortController();
    controller.abort();
    const parse = vi.fn((value: unknown) => value);
    const validate = vi.fn(() => ({ checks: [pass] }));
    const config = resolveAnswerValidation({ id: 'abort', version: '1', validate });
    expect(
      (await executeAnswerValidation('{}', { parse }, config, undefined, scope, controller.signal))
        .report.reason,
    ).toBe('aborted');
    expect(parse).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });

  it('a claimed evidence reference must actually resolve in this validation', async () => {
    const config = resolveAnswerValidation({
      id: 'refs',
      version: '1',
      validate: () => ({ checks: [{ ...pass, evidenceRefs: ['art_aaaaaaaaaaaaaaaaaaaaaa'] }] }),
    });
    expect(
      (await executeAnswerValidation('{}', parser, config, undefined, scope)).report,
    ).toMatchObject({ status: 'unverified', checked: 0 });
  });

  it('an unawaited evidence read cannot make the report pass or add late references', async () => {
    const store = inMemoryArtifacts();
    const { meta } = await store.put(scope, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: { total: 42 },
    });
    let release: (() => void) | undefined;
    const get = vi.spyOn(store, 'get');
    vi.spyOn(store, 'head').mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return meta;
    });
    const config = resolveAnswerValidation({
      id: 'unfinished-read',
      version: '1',
      validate(_candidate, context) {
        void context.artifacts.resolve(meta.ref, { kind: 'dataset/rows' });
        return { checks: [pass] };
      },
    });
    const result = await executeAnswerValidation('{}', parser, config, store, scope);
    expect(result.report).toMatchObject({
      status: 'unverified',
      reason: 'evidence-closed',
      resolvedRefs: [],
    });
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get).not.toHaveBeenCalled();
    expect(result.report.resolvedRefs).toEqual([]);
  });

  it('successful artifact resolution is separate from an actual comparison over that artifact', async () => {
    const store = inMemoryArtifacts();
    const { meta } = await store.put(scope, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: { total: 42 },
      digest: 'sha-256',
    });
    for (const expected of [42, 99]) {
      const config = resolveAnswerValidation<{ total: number }>({
        id: 'observed-commerce',
        version: '1',
        validate: async (candidate, context) => {
          const evidence = await context.artifacts.resolve(meta.ref, { kind: 'dataset/rows' });
          if (!evidence.ok) return { checks: [{ id: 'sum', disposition: 'unreachable' }] };
          return {
            checks: [
              {
                id: 'sum',
                disposition:
                  (evidence.record.data as { total: number }).total === candidate.total
                    ? 'checked-pass'
                    : 'checked-fail',
                evidenceRefs: [meta.ref],
              },
            ],
          };
        },
      });
      const result = await executeAnswerValidation(
        JSON.stringify({ total: expected }),
        parser,
        config,
        store,
        scope,
      );
      expect(result.report).toMatchObject({
        status: expected === 42 ? 'passed' : 'failed',
        checked: 1,
        failed: expected === 42 ? 0 : 1,
        resolvedRefs: [meta.ref],
      });
    }
  });

  it('copies and freezes the definition, rejecting invalid limits and accessor configuration', () => {
    const source = {
      id: 'stable',
      version: '1',
      limits: { maxReads: 2 },
      validate: () => ({ checks: [pass] }),
    };
    const config = resolveAnswerValidation(source);
    source.limits.maxReads = 99;
    expect(config.limits.maxReads).toBe(2);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.limits)).toBe(true);
    for (const limits of [
      { maxReads: 0 },
      { maxBytes: NaN },
      { timeoutMs: Infinity },
      { maxChecks: -1 },
      { maxCandidateBytes: 1.5 },
      { typo: 1 },
    ]) {
      expect(() => resolveAnswerValidation({ ...source, limits } as never)).toThrow();
    }
    const getter = vi.fn(() => source.validate);
    expect(() =>
      resolveAnswerValidation(
        Object.defineProperty({ id: 'x', version: '1' }, 'validate', { get: getter }) as never,
      ),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
