import { describe, it, expect } from 'vitest';
import { headingSlugs } from '../../docs-next/lib/heading-slugs.mjs';
import { API_GROUPS, groupApiPages, resolveApiAlias } from '../../docs-next/lib/api-groups.mjs';

function fixture() {
  return new Map(
    API_GROUPS.flatMap((group) =>
      group.members.map((name) => [
        `interfaces/${name}.md`,
        `---\ntitle: ${name}\n---\n\n# Interface: ${name}\n\n${name} keeps its own description.\n\n## Properties\n\n### value\n\nA retained value.\n\n### value\n\nSecond value.\n\n[Read](/docs/api/interfaces/ReadEvent#value)\n\n[Self](#properties)\n\n\x60\x60\x60ts\n// [Do not rewrite](/docs/api/interfaces/ReadEvent#value)\nconst value = 3;\n\x60\x60\x60\n`,
      ]),
    ),
  );
}

describe('grouped generated API pages', () => {
  it('combines sixteen related interfaces into two pages, without mutating the input', () => {
    const input = fixture();
    const before = new Map(input);
    const result = groupApiPages(input);
    expect([...result.pages.keys()]).toEqual([
      'interfaces/scope-events.md',
      'interfaces/flow-events.md',
    ]);
    expect(result.aliases).toHaveLength(16);
    expect(input).toEqual(before);
  });

  it('keeps every description, code fence, duplicate-heading anchor and source identity', () => {
    const result = groupApiPages(fixture());
    for (const group of API_GROUPS) {
      const page = result.pages.get(`interfaces/${group.slug}.md`)!;
      for (const name of group.members) {
        expect(page).toContain(`${name} keeps its own description.`);
        const alias = result.aliases.find((entry) => entry.anchor === name)!;
        const ids = headingSlugs(page);
        expect(ids.has(alias.target)).toBe(true);
        for (const target of Object.values(alias.fragments)) expect(ids.has(target)).toBe(true);
        expect(alias.fragments.value).not.toBe(alias.fragments['value-1']);
        expect(page).not.toContain('<span');
        expect(page).toContain(
          `[Self](/docs/api/interfaces/${group.slug}#${alias.fragments.properties})`,
        );
      }
      expect(page).toContain('[Read](/docs/api/interfaces/scope-events#value-6)');
      expect(page).toContain('// [Do not rewrite](/docs/api/interfaces/ReadEvent#value)');
    }
  });

  it('rewrites inbound links but leaves unrelated pages and external URLs intact', () => {
    const pages = fixture();
    pages.set(
      'functions/use.md',
      '[Read](/docs/api/interfaces/ReadEvent#value)\n[External](https://example.com/docs/api/interfaces/ReadEvent)',
    );
    pages.set('classes/Untouched.md', 'Unrelated source bytes.\n');
    const result = groupApiPages(pages);
    expect(result.pages.get('functions/use.md')).toContain(
      '/docs/api/interfaces/scope-events#value-6',
    );
    expect(result.pages.get('functions/use.md')).toContain(
      'https://example.com/docs/api/interfaces/ReadEvent',
    );
    expect(result.pages.get('classes/Untouched.md')).toBe(pages.get('classes/Untouched.md'));
  });

  it('preserves old symbol and property URLs through a bounded internal alias', () => {
    const { aliases } = groupApiPages(fixture());
    expect(resolveApiAlias('/docs/api/interfaces/ReadEvent', aliases)).toBe(
      '/docs/api/interfaces/scope-events#interface-readevent',
    );
    expect(resolveApiAlias('/docs/api/interfaces/ReadEvent#value-1', aliases)).toBe(
      '/docs/api/interfaces/scope-events#value-7',
    );
    expect(resolveApiAlias('/docs/api/interfaces/ReadEvent#__proto__', aliases)).toBe(
      '/docs/api/interfaces/scope-events#interface-readevent',
    );
    expect(resolveApiAlias('https://other.example/docs/api/interfaces/ReadEvent', aliases)).toBe(
      'https://other.example/docs/api/interfaces/ReadEvent',
    );
  });

  it('refuses a missing declaration or a destination collision rather than losing docs', () => {
    const missing = fixture();
    missing.delete('interfaces/ReadEvent.md');
    expect(() => groupApiPages(missing)).toThrow(/missing/);
    const collision = fixture();
    collision.set('interfaces/flow-events.md', 'already exists');
    expect(() => groupApiPages(collision)).toThrow(/collision/);
  });
});
