import { describe, expect, it } from 'vitest';
import { run } from '../../examples/features/114-saved-cause-tools.js';
import { run as runSources } from '../../examples/features/115-saved-read-sources.js';

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

  it('reads native exact-source ownership from an acknowledged file without promoting output derivation', async () => {
    const result = await runSources();
    expect(result.modelCalls).toBe(0);
    if (!('root' in result)) throw Error('The source history must be admitted.');
    expect(result.root.finding.rootCause).toEqual(expect.any(String));
    expect(result.root.capture.readSources).toBe('captured');
    expect(result.impact.finding.edges.length).toBeGreaterThan(0);
    expect(result.derivation.finding.rootCause).toBeUndefined();
    expect(result.derivation.finding.confidence).toBe('incomplete');
  });
});
