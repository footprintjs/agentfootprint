import { describe, expect, it } from 'vitest';
import { toolFailure } from '../../../../../semantics/toolFailure.js';
import { defineTool } from '../../../../../tools/tools.js';
import { captureToolReturn, readExecutedResult } from './readExecutedResult.js';

const tool = defineTool({
  name: 'collector',
  description: 'Reads the collector.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'done',
});

describe('tool failure captured at the execution boundary', () => {
  it('retains the native declaration while allowing a copy of the payload', () => {
    const native = toolFailure({ rows: [] }, { category: 'timeout', notChecked: 'primary' });
    const captured = captureToolReturn(native, 100, performance.now());
    expect(
      readExecutedResult(tool, structuredClone(captured.result), {}, captured.declaredFailure),
    ).toMatchObject({
      content: { rows: [] },
      status: 'failure',
      declaredFailure: { category: 'timeout', notChecked: 'primary', startedAt: 100 },
    });
    expect(captured.declaredFailure?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('does not promote an ordinary copy of the constructor result', () => {
    const copy = structuredClone(toolFailure('ordinary', { category: 'network' }));
    const captured = captureToolReturn(copy, 100, performance.now());
    expect(captured.result).toBe(copy);
    expect(readExecutedResult(tool, copy, {}, captured.declaredFailure)).toBeUndefined();
  });
});
