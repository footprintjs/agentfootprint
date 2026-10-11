import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { DefineSkillOptions } from '../../src/doors/context.js';
// @ts-expect-error RefreshPolicy was never acted on and is removed in 10
import type { RefreshPolicy } from '../../src/doors/context.js';
// @ts-expect-error recorder is no longer a member, not merely deprecated
type RemovedRecorder = ReturnType<typeof Agent.create>['recorder'];
// @ts-expect-error the unsupported option is absent from the current declaration
type RemovedRefresh = DefineSkillOptions['refreshPolicy'];

describe('major 10 compatibility retirement', () => {
  it('exposes watch, without a recorder stub', () => {
    const builder = Agent.create({ provider: mock(), model: 'mock' });
    expect('recorder' in builder).toBe(false);
    expect(builder.watch).toBeTypeOf('function');
  });
});
