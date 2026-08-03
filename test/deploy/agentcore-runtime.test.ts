/**
 * The AgentCore Runtime deploy template, run for real.
 *
 * `examples/deploy/agentcore-runtime.ts` used to carry its own hand-written
 * `node:http` handler, and this file tested that handler. Since 7.15.0 the
 * template composes `agentCoreRuntimeHost` + `agentCoreSessions` +
 * `standingAgent` instead, so the adapter's own contract tests live in
 * `test/hosting/agentcore-runtime-host.test.ts` and this file asserts the thing
 * only the example can prove: **the documented deploy template still works, end
 * to end, exactly as its README says.**
 *
 * That matters because the README's contract table is the thing a reader
 * copies. If the example drifts from it, the table becomes a lie that no unit
 * test would ever notice.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../../examples/deploy/agentcore-runtime.js';

interface TemplateResult {
  readonly ping: { readonly status: string; readonly time_of_last_update: number };
  readonly turn1: { readonly response?: string; readonly status?: string };
  readonly turn2: { readonly response?: string; readonly status?: string };
  readonly rememberedAcrossRequests: boolean;
  readonly notFoundStatus: number;
}

describe('deploy/agentcore-runtime — the template, executed', () => {
  it('serves the whole documented contract in one run', async () => {
    const result = (await run("what's the status of fc1/3?")) as TemplateResult;

    // GET /ping → { status: 'Healthy', time_of_last_update: <unix SECONDS> }
    expect(result.ping.status).toBe('Healthy');
    expect(result.ping.time_of_last_update).toBeLessThan(Date.now() / 1000 + 60);

    // POST /invocations → { response, status: 'success' }
    expect(result.turn1.status).toBe('success');
    expect(result.turn1.response).toContain('fc1/3');

    // Anything else → 404
    expect(result.notFoundStatus).toBe(404);
  });

  it('remembers a conversation across requests, through the session header alone', async () => {
    // The session id never touches the body in this contract. If the header
    // mapping regressed, turn 2 would answer as a stranger and this goes red.
    const result = (await run('my switch is fc1/3')) as TemplateResult;
    expect(result.turn2.status).toBe('success');
    expect(result.rememberedAcrossRequests).toBe(true);
  });

  it('cleans up after itself — the example leaves no session file behind', async () => {
    const { access } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    await run('anything');
    await expect(
      access(join(tmpdir(), `agentcore-session-example-${process.pid}`)),
    ).rejects.toThrow();
  });
});
