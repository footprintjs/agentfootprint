/**
 * Integration test — runs the permissions example end-to-end.
 *
 * ── The finding this exists for ─────────────────────────────────────────────
 * An independent reviewer (2026-08-13) drove the strongest permission surface
 * this library has — on a DETERMINISTIC LOCAL harness, a mock model and a
 * thrown `Error` for the "authorizer outage", with no live authorization
 * service anywhere in it, which is exactly why this file can reproduce it byte
 * for byte: a tool DECLARING `memory_write` and
 * `user_data`, a read-only role passing the tool-name allowlist and still
 * failing the `memory_write` capability check (zero executions), an admin role
 * clearing all three questions (one execution), and a checker that threw
 * `simulated authorizer outage` failing CLOSED with the operator error in its
 * rationale. The documentation round beside it then reported that the shipped
 * example demonstrated none of that — only `allow`/`deny` with a
 * `policyRuleId` and a `rationale`, so `halt`, `reason`, `tellLLM`, declared
 * capabilities and `PermissionPolicy.fromRoles` were invisible to a reader.
 *
 * The example now IS that run's shape, so this test is what keeps it honest:
 * the governance page quotes these four scenes, and an example that silently
 * stops demonstrating them is a page that silently lies.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../../examples/features/03-permissions.js';

describe('permissions example — integration', () => {
  it("reproduces the independent reviewer's four scenes", async () => {
    const result = await run('save this customer note');

    // Scene 1 — THE CRITICAL PIN. The tool name was allowed and the tool still
    // never ran, because a capability it DECLARES was refused.
    expect(result.readOnly.executions).toBe(0);
    const capabilityDenials = result.readOnly.denied.filter((d) => d.capability === 'memory_write');
    expect(capabilityDenials.length).toBeGreaterThan(0);
    expect(capabilityDenials[0]!.target).toBe('save_note');
    // The rule that decided is named, so a denial is traceable to a role.
    expect(capabilityDenials[0]!.policyRuleId).toBe('readonly.capabilities.miss');
    // And it really is the CAPABILITY question that failed, not the allowlist.
    expect(result.readOnly.denied.some((d) => d.capability === 'tool_call')).toBe(false);

    // Scene 2 — the same tool, a role that may exercise what it declares.
    expect(result.admin.executions).toBe(1);
    expect(result.admin.allowedCapabilities).toContain('tool_call');
    expect(result.admin.allowedCapabilities).toContain('memory_write');
    expect(result.admin.allowedCapabilities).toContain('user_data');

    // Scene 3 — fail-closed, with the operator's error diagnosable rather than
    // merely swallowed into a generic denial.
    expect(result.failClosed.executions).toBe(0);
    expect(result.failClosed.rationale).toContain('simulated authorizer outage');

    // Scene 4 — halt carries BOTH vocabularies: the routing tag and the
    // sentence the model was actually shown. `tellLLM` never falls back to
    // `reason`, which is why they are asserted separately.
    expect(result.halted.executions).toBe(0);
    expect(result.halted.reason).toBe('security:exfiltration');
    expect(result.halted.tellLLM).toContain('human approver');
    expect(result.halted.tellLLM).not.toBe(result.halted.reason);
  }, 30_000);
});
