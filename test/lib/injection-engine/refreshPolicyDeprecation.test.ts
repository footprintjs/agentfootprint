/**
 * `refreshPolicy` — DEPRECATED-pending-steps (9.16.0).
 *
 * The field has been stored-and-never-read since it shipped; a planned
 * steps-as-data feature supersedes it, so it is now loudly deprecated
 * WITHOUT being removed (additive-only law):
 *   • jsdoc `@deprecated` on `RefreshPolicy` + `DefineSkillOptions.refreshPolicy`;
 *   • a dev-mode warn that fires ONCE per process, not per skill;
 *   • the value still lands on `skill.metadata.refreshPolicy` byte-identically.
 *
 * Phases share one test deliberately: the once-per-process flag is module
 * state, so the no-dev-mode phase must run before the flag is consumed.
 */

import { describe, it, expect, vi } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { defineSkill } from '../../../src/injection-engine.js';

describe('defineSkill refreshPolicy deprecation (9.16.0)', () => {
  it('warns once per process in dev mode, never outside it, and still stores the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const policy = { afterTokens: 50_000, via: 'tool-result' as const };

      // Phase 1 — dev mode OFF: silent (production pays zero cost), and the
      // once-flag is NOT consumed by a silent pass.
      const quiet = defineSkill({ id: 's0', description: 'd', body: 'b', refreshPolicy: policy });
      expect(warn).not.toHaveBeenCalled();
      // Stored, not removed — the additive-only pin.
      expect((quiet.metadata as { refreshPolicy?: unknown }).refreshPolicy).toEqual(policy);

      // Phase 2 — dev mode ON: the first declaration warns, and TEACHES.
      enableDevMode();
      defineSkill({ id: 's1', description: 'd', body: 'b', refreshPolicy: policy });
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]![0]);
      expect(msg).toContain('DEPRECATED-pending-steps'); // what it is
      expect(msg).toContain('nothing in the engine reads it'); // what it (never) does
      expect(msg).toContain("surfaceMode: 'both'"); // what to do instead

      // Phase 3 — a second declaration does NOT warn again (once per
      // process, not once per skill of a 40-skill catalog).
      defineSkill({ id: 's2', description: 'd', body: 'b', refreshPolicy: policy });
      expect(warn).toHaveBeenCalledTimes(1);

      // Phase 4 — a skill WITHOUT the option never warns and carries no key.
      const clean = defineSkill({ id: 's3', description: 'd', body: 'b' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect('refreshPolicy' in (clean.metadata as object)).toBe(false);
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });
});
