import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Injection } from '../../../../injection-engine/types.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import { defineTool } from '../../../../tools/tools.js';
import { warnRedundantSkillScopedTools } from './tools.js';

const mode = vi.hoisted(() => ({ enabled: true }));
vi.mock('footprintjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('footprintjs')>()),
  isDevMode: () => mode.enabled,
}));

const tool = defineTool({ name: 'read', description: 'Read', execute: () => 'done' });
const provider = (id = 'skill-scoped:billing'): ToolProvider => ({ id, list: () => [] });
const skill = (
  options: {
    readonly id?: string;
    readonly autoActivate?: string;
    readonly tools?: boolean;
  } = {},
): Injection => ({
  id: options.id ?? 'billing',
  flavor: 'skill',
  trigger: { kind: 'always' },
  inject: { tools: options.tools === false ? [] : [tool] },
  metadata: { autoActivate: options.autoActivate ?? 'currentSkill' },
});

beforeEach(() => {
  mode.enabled = true;
});
afterEach(() => vi.restoreAllMocks());

describe('redundant skill-tool gate warning', () => {
  it('warns when the named skill already gates its own tools', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnRedundantSkillScopedTools(provider(), [skill()]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skillScopedTools('billing')"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DIFFERENT signals'));
  });

  it('leaves other providers and other skill ids alone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnRedundantSkillScopedTools(undefined, [skill()]);
    warnRedundantSkillScopedTools(provider('other-provider'), [skill()]);
    warnRedundantSkillScopedTools(provider(), [skill({ id: 'other-skill' })]);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when the skill has no tools or does not gate them itself', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnRedundantSkillScopedTools(provider(), [skill({ tools: false })]);
    warnRedundantSkillScopedTools(provider(), [skill({ autoActivate: 'always' })]);

    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the warning silent outside development mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mode.enabled = false;

    warnRedundantSkillScopedTools(provider(), [skill()]);

    expect(warn).not.toHaveBeenCalled();
  });
});
