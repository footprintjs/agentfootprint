import { expect } from 'vitest';

/** Expected side only: one new AF14 local-status observation after resume configuration. */
export function withNativeResourceObservation<T extends { readonly eventTypes: readonly string[] }>(
  legacy: T,
): T {
  const types = [...legacy.eventTypes];
  expect(types).not.toContain('agentfootprint.tools.resource_restore');
  const resumes = types.flatMap((type, index) =>
    type === 'agentfootprint.pause.resume' ? [index] : [],
  );
  expect(resumes.length).toBeLessThanOrEqual(1);
  if (resumes.length === 0) return legacy;
  const resume = resumes[0]!;
  expect(types[resume + 1]).toBe('agentfootprint.agent.run_configured');
  types.splice(resume + 2, 0, 'agentfootprint.tools.resource_restore');
  return { ...legacy, eventTypes: types };
}
