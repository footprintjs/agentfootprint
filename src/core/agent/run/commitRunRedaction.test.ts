import { expect, it } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import { commitRunRedaction } from './commitRunRedaction.js';
import { PRIVATE_CALLER_NONE } from '../../../redaction/privateCaller.js';

it('an unbound scope cannot declare that its caller policy is none', () => {
  const scope = {} as TypedScope<AgentState>;
  commitRunRedaction(scope);
  expect(scope.runRedaction).toBeDefined();
  expect(scope.runRedaction).not.toEqual(PRIVATE_CALLER_NONE);
  expect(scope.runRedaction).toHaveProperty('vocabulary');
});
