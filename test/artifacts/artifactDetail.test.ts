import { describe, expect, it, vi } from 'vitest';
import {
  ArtifactDetailError,
  artifactDetailTool,
  bindArtifacts,
  inMemoryArtifacts,
} from '../../src/index.js';
import type { ToolExecutionContext } from '../../src/index.js';

async function fixture() {
  const artifacts = bindArtifacts(inMemoryArtifacts(), { conversationId: 'detail-fixture' });
  const stored = await artifacts.put({
    kind: 'evidence/fixture',
    mediaType: 'application/json',
    data: {},
  });
  const ctx = { runId: 'run-one', hasArtifacts: true, artifacts } as ToolExecutionContext;
  return { ref: stored.ref, ctx };
}

describe('artifact detail tool', () => {
  it('uses typed fixed refusals for invalid arguments, unavailable admission and cancellation', async () => {
    const { ref, ctx } = await fixture();
    const tool = artifactDetailTool({
      name: 'proof_detail',
      admit: async () => {
        throw new Error('private-callback-value');
      },
    });
    await expect(tool.execute({ ref, path: '/constructor' }, ctx)).rejects.toMatchObject({
      name: 'ArtifactDetailError',
      code: 'ERR_ARTIFACT_DETAIL_INVALID',
      message: 'Invalid artifact detail request.',
    });
    await expect(tool.execute({ ref, path: '' }, ctx)).rejects.toMatchObject({
      name: 'ArtifactDetailError',
      code: 'ERR_ARTIFACT_DETAIL_UNAVAILABLE',
      message: 'Artifact detail is unavailable.',
    });
    const controller = new AbortController();
    controller.abort(new Error('private-abort-value'));
    await expect(
      tool.execute({ ref, path: '' }, { ...ctx, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'ArtifactDetailError',
      code: 'ERR_ARTIFACT_DETAIL_CANCELLED',
      message: 'Artifact detail request was cancelled.',
    });
  });

  it('retains the invalid-request refusal for a non-index segment into an admitted array', async () => {
    const { ref, ctx } = await fixture();
    const tool = artifactDetailTool({
      name: 'proof_detail',
      admit: async () => ({ rows: [{ latency: 40 }] }),
    });
    const error: unknown = await Promise.resolve()
      .then(() => tool.execute({ ref, path: '/rows/not-an-index' }, ctx))
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ArtifactDetailError);
    expect(error).toMatchObject({
      code: 'ERR_ARTIFACT_DETAIL_INVALID',
      message: 'Invalid artifact detail request.',
    });
    expect(await tool.execute({ ref, path: '/rows/0/latency' }, ctx)).toMatchObject({
      mode: 'value',
      value: 40,
    });
  });

  it('serves an admitted section with escaped keys and namespaced, detached context', async () => {
    const { ref, ctx } = await fixture();
    const root = { 'a/b': { '~key': { latency: 40 } } };
    const context = { ref: 'domain-reference', mode: 'domain-mode', window: { start: 'capture' } };
    const admit = vi.fn(async () => root);
    const tool = artifactDetailTool({ name: 'proof_detail', admit, context: () => context });
    const result = await tool.execute({ ref, path: '/a~1b/~0key' }, ctx);
    expect(admit).toHaveBeenCalledWith(ref, ctx);
    expect(result).toMatchObject({
      ref,
      path: '/a~1b/~0key',
      mode: 'value',
      kind: 'object',
      value: { latency: 40 },
      complete: true,
      context,
    });
    expect(result.ref).toBe(ref);
    expect(result.mode).toBe('value');
    root['a/b']['~key'].latency = 900;
    context.window.start = 'changed';
    expect(result).toMatchObject({
      value: { latency: 40 },
      context: { window: { start: 'capture' } },
    });
  });

  it('pages exact direct children and emits actions that open their actual values', async () => {
    const { ref, ctx } = await fixture();
    const root = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`key-${index}`, { index }]),
    );
    const tool = artifactDetailTool({ name: 'proof_detail', admit: async () => root });
    const first = await tool.execute({ ref, path: '' }, ctx);
    expect(first).toMatchObject({
      mode: 'children',
      shown: 20,
      total: 25,
      complete: false,
      nextOffset: 20,
    });
    if (first.mode !== 'children') throw new Error('Expected navigable children.');
    const action = first.children[0]!.action;
    expect(action).toEqual({ tool: 'proof_detail', args: { ref, path: '/key-0' } });
    expect(await tool.execute(action.args, ctx)).toMatchObject({
      mode: 'value',
      value: { index: 0 },
      complete: true,
    });
    expect(await tool.execute({ ref, path: '', offset: first.nextOffset }, ctx)).toMatchObject({
      mode: 'children',
      offset: 20,
      shown: 5,
      total: 25,
      complete: true,
    });
  });

  it('omits an oversized multibyte scalar whole and never reads a store implicitly', async () => {
    const { ref, ctx } = await fixture();
    const text = '界'.repeat(3000);
    const head = vi.spyOn(ctx.artifacts, 'head');
    const get = vi.spyOn(ctx.artifacts, 'get');
    const tool = artifactDetailTool({
      name: 'proof_detail',
      admit: async () => ({ opaque: text }),
    });
    const result = await tool.execute({ ref, path: '/opaque' }, ctx);
    expect(result).toMatchObject({
      mode: 'scalar-omitted',
      omitted: true,
      complete: false,
      scalarBytes: 9002,
    });
    expect(JSON.stringify(result)).not.toContain('界');
    expect(head).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      12 * 1024,
    );
  });

  it('re-admits every call and refuses a later withdrawn authorization without echoing its error', async () => {
    const { ref, ctx } = await fixture();
    let authorized = true;
    const admit = vi.fn(async () => {
      if (!authorized) throw new Error('private-origin-and-credential');
      return { measured: 40 };
    });
    const tool = artifactDetailTool({ name: 'proof_detail', admit });
    expect(await tool.execute({ ref, path: '/measured' }, ctx)).toMatchObject({
      mode: 'value',
      value: 40,
    });
    authorized = false;
    await expect(tool.execute({ ref, path: '/measured' }, ctx)).rejects.not.toThrow(
      'private-origin-and-credential',
    );
    expect(admit).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe pointers and forged work controls before admitting a proof', async () => {
    const { ref, ctx } = await fixture();
    const admit = vi.fn(async () => ({ measured: 40 }));
    const tool = artifactDetailTool({ name: 'proof_detail', admit });
    for (const path of [
      '/__proto__/secret',
      '/constructor',
      '/bad~escape',
      '/' + 'x/'.repeat(16) + 'x',
    ]) {
      await expect(tool.execute({ ref, path }, ctx)).rejects.toThrow();
    }
    await expect(tool.execute({ ref, path: '', limit: 21 }, ctx)).rejects.toThrow();
    await expect(
      tool.execute({ ref, path: '', maxBytes: 10 ** 9 } as never, ctx),
    ).rejects.toThrow();
    expect(admit).not.toHaveBeenCalled();
  });
});
