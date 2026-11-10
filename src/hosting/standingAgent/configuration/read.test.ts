import { describe, expect, it, vi } from 'vitest';
import { readConfiguration } from './read.js';
import { memorySessions } from '../../memorySessions.js';

describe('standing agent construction', () => {
  it('refuses an empty builder before serving the host', () => {
    const serve = vi.fn();
    expect(() =>
      readConfiguration({
        sessions: memorySessions(),
        host: { name: 'test', capabilities: [], serve },
      } as never),
    ).toThrow('needs something to answer with');
    expect(serve).not.toHaveBeenCalled();
  });
  it('retains the explicit unbounded artifact budget and one counter', () => {
    const config = readConfiguration({
      agentFactory: vi.fn(),
      sessions: memorySessions(),
      host: { name: 'test', capabilities: [], serve: vi.fn() },
      artifactOpsPerSession: Infinity,
    });
    expect(config.artifactOpsPerSession).toBe(Infinity);
    expect(config.artifactOpsInFlight.size).toBe(0);
  });
});
