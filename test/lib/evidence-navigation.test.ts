import { describe, it, expect } from 'vitest';
import * as context from '../../src/doors/context.js';

const need = { id: 'queue-health', description: 'Worker-health evidence for this queue.' };
const route = {
  id: 'health-owner',
  need: need.id,
  destination: 'operations-owner',
  description: 'Request worker-health observations.',
  requiredInputs: ['queue', 'interval'],
};
const resolve = (...args: any[]) => (context as any).resolveEvidenceNeed(...args);

describe('declared evidence navigation', () => {
  it('distinguishes no configured map from no match without claiming evidence is nonexistent', () => {
    expect(resolve(need).status).toBe('not_configured');
    expect(resolve(need, []).status).toBe('no_matching_route');
    expect(resolve(need, [{ ...route, need: 'another-need' }]).routes).toEqual([]);
  });
  it('offers configured destinations as proposals, with explicit missing input names', () => {
    const result = resolve(need, [route], ['queue']);
    expect(result.status).toBe('matched');
    expect(result.routes[0]).toMatchObject({
      id: route.id,
      status: 'needs_input',
      missingInputs: ['interval'],
    });
    expect(resolve(need, [route], ['queue', 'interval']).routes[0].status).toBe('proposed');
    expect(JSON.stringify(result)).not.toMatch(/executed|succeeded|authorized/);
  });
  it('preserves multiple alternatives without ranking or running them', () => {
    expect(
      resolve(need, [
        route,
        { ...route, id: 'alternate', destination: 'another-owner' },
      ]).routes.map((r: any) => r.id),
    ).toEqual(['health-owner', 'alternate']);
  });
  it('detaches and freezes the bounded result without changing app declarations', () => {
    const local = structuredClone(route);
    const before = structuredClone(local);
    const result = resolve(need, [local]);
    local.requiredInputs.push('new-input');
    expect(result.routes[0].requiredInputs).toEqual(before.requiredInputs);
    expect(Object.isFrozen(result.routes[0].missingInputs)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('refuses duplicate identities, oversized maps, malformed declarations and undeclared input shapes', () => {
    expect(() => resolve(need, [route, route])).toThrow();
    expect(() =>
      resolve(
        need,
        Array.from({ length: 17 }, (_, i) => ({ ...route, id: String(i) })),
      ),
    ).toThrow();
    expect(() => resolve({ ...need, description: '' })).toThrow();
    expect(() => resolve(need, [{ ...route, requiredInputs: ['queue', 'queue'] }])).toThrow();
    expect(() => resolve(need, [route], [null])).toThrow();
  });
});
