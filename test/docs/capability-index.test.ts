/**
 * The capability index in CLAUDE.md may omit, but must never lie.
 *
 * The table exists because a reader searches for the words THEY would use, finds
 * nothing, and builds a feature this library has shipped for releases — which
 * happened three times in one day with the typed-HITL ask, element bindings by
 * role and name, and the artifact-kind renderer. An index that cures that is only
 * worth having if it is TRUE, and a stale row pointing at a deleted file is worse
 * than no row: it costs the reader the same search plus a wrong turn.
 *
 * So: every path a row names must exist, and every symbol it names must appear in
 * the tree it points at. The table can still go out of date by omission — nothing
 * cheap forces a new capability to add a row — and that is the honest limit,
 * stated rather than papered over.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** `| what you'd build | `symbol` | `path` | since |` */
function indexRows(): { symbol: string; where: string }[] {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const rows: { symbol: string; where: string }[] = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| If you are') || line.startsWith('|---'))
      continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    const symbol = cells[2] ?? '';
    const where = (cells[3] ?? '').replace(/`/g, '');
    if (where === '' || where === '—') continue;
    rows.push({ symbol: symbol.replace(/`/g, ''), where });
  }
  return rows;
}

function textUnder(target: string): string {
  const full = join(ROOT, target);
  if (!existsSync(full)) return '';
  if (statSync(full).isFile()) return readFileSync(full, 'utf8');
  let out = '';
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out += readFileSync(p, 'utf8');
    }
  };
  walk(full);
  return out;
}

describe('the capability index names things that exist', () => {
  const rows = indexRows();

  it('finds the table at all — a silently empty parse would pass every row', () => {
    expect(rows.length).toBeGreaterThan(8);
  });

  for (const { symbol, where } of rows) {
    it(`${symbol} really lives in ${where}`, () => {
      expect(existsSync(join(ROOT, where)), `${where} does not exist`).toBe(true);
      const haystack = textUnder(where);
      // A row may name several symbols joined by `+` or `/`; any one is enough
      // to prove the pointer still lands somewhere real.
      const names = symbol
        .split(/[+/]/)
        .map((n) => n.trim().replace(/`/g, ''))
        .filter(Boolean);
      const found = names.some((n) => haystack.includes(n));
      expect(found, `none of ${names.join(', ')} appears under ${where}`).toBe(true);
    });
  }
});
