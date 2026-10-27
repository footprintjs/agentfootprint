import { describe, expect, it } from 'vitest';
import { run } from '../../examples/features/114-saved-cause-tools.js';

describe('saved cause example with actual file acknowledgement', () => {
  it('reads the saved history and serves a root and impact without a model', async () => {
    const result = await run();
    expect(result.modelCalls).toBe(0);
    expect('root' in result).toBe(true);
    if (!('root' in result)) throw Error('The real-file fixture must be admitted.');
    expect(result.root.finding.rootCause).toEqual(expect.any(String));
    expect(result.root.capture.persistence).toBe('memory-only');
    expect(result.root.storage).toEqual({
      status: 'adapter-acknowledged-history',
      scope: 'root-log',
    });
    expect(result.impact.finding.nodes.length).toBeGreaterThan(0);
  });
});
