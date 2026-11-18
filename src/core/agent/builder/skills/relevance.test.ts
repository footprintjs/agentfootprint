import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Injection } from '../../../../injection-engine/types.js';
import { READS_ENTRY_SCORES_METADATA_KEY } from '../../../../injection-engine/factories/defineRelevanceHint.js';
import { warnInertRelevanceHint } from './relevance.js';

const mode = vi.hoisted(() => ({ enabled: true }));
vi.mock('footprintjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('footprintjs')>()),
  isDevMode: () => mode.enabled,
}));

const hint = (id: string, metadata?: Injection['metadata']): Injection => ({
  id,
  flavor: 'instructions',
  trigger: { kind: 'always' },
  inject: {},
  ...(metadata !== undefined && { metadata }),
});

beforeEach(() => {
  mode.enabled = true;
});
afterEach(() => vi.restoreAllMocks());

describe('relevance-hint configuration warning', () => {
  it('recognizes the marker after a caller renames the injection', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnInertRelevanceHint([hint('renamed', { [READS_ENTRY_SCORES_METADATA_KEY]: true })], false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("injection 'renamed'"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has none'));
  });

  it('does not warn when the graph has a scorer or an injection lacks the marker', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const marked = hint('marked', { [READS_ENTRY_SCORES_METADATA_KEY]: true });

    warnInertRelevanceHint([marked], true);
    warnInertRelevanceHint([hint('plain'), hint('off', { readsEntryScores: false })], false);

    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the warning silent outside development mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mode.enabled = false;

    warnInertRelevanceHint([hint('marked', { [READS_ENTRY_SCORES_METADATA_KEY]: true })], false);

    expect(warn).not.toHaveBeenCalled();
  });
});
