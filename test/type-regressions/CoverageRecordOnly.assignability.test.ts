/**
 * Compile-level regression test — the record-only coverage fields and the
 * other two declared facts of the "explain this answer" packet.
 *
 * What the real compiler (`npm run test:types`) pins:
 *
 *   1. **`CoverageItem` takes `short` and a CLOSED `kind`** — `'existence'` and
 *      `'scope'` compile, anything else does not (`@ts-expect-error`).
 *   2. **The event item type agrees with the declaration item type** — a
 *      declared `CoverageItem` is assignable to `CoverageItemPayload` and back,
 *      so the copy the dispatch door makes cannot drift from what the author
 *      typed.
 *   3. **`defineSkill({ title })` compiles and `graph_declared` nodes carry
 *      `title?: string`**, and `evidence_checked` carries `lookedUp?: number`
 *      (optional: a recording made before it has none).
 *
 * The `.test.ts` name lets `npm test` run the runtime assertions too.
 */
import { describe, expect, it } from 'vitest';

import { absent, type CoverageItem } from '../../src/index';
import { defineSkill } from '../../src/injection-engine';
import type {
  AgentEvidenceCheckedPayload,
  CoverageItemPayload,
  SkillGraphDeclaredPayload,
} from '../../src/events/payloads';

describe('record-only coverage fields — the types', () => {
  it('a CoverageItem takes short and a closed kind', () => {
    const item: CoverageItem = {
      what: 'whether that name is a storage array',
      short: 'whether it is an array',
      kind: 'existence',
    };
    // @ts-expect-error — 'window' is not in the closed set (yet)
    const wrong: CoverageItem = { what: 'the last 24h', kind: 'window' };
    expect(wrong.what).toBe('the last 24h');
    const payload: CoverageItemPayload = item;
    const back: CoverageItem = payload;
    expect(back.kind).toBe('existence');
    const minted = absent({ what: 'a disk', checked: ['the export'], notChecked: [item] });
    const kind: 'existence' | 'scope' | undefined = minted.not_checked?.[0]?.kind;
    expect(kind).toBe('existence');
  });

  it('a skill title and the two payload fields', () => {
    const skill = defineSkill({
      id: 'array-inventory',
      title: 'array estate report',
      description: 'd',
      body: 'b',
    });
    const title: string | undefined = skill.title;
    expect(title).toBe('array estate report');
    const node: SkillGraphDeclaredPayload['nodes'][number] = { id: 'x', kind: 'skill', title: 't' };
    expect(node.title).toBe('t');
    const lookedUp: AgentEvidenceCheckedPayload['lookedUp'] = 1;
    const count: number | undefined = lookedUp;
    expect(count).toBe(1);
  });
});
