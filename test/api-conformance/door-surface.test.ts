/**
 * THE DOOR SURFACE — every name each `package.json` door exports, read from SOURCE and pinned.
 *
 * WHY. Moving a file inside `src/` is an internal change only while every door hands out
 * exactly the names it did before. `subpath-exports.test.ts` pins WHICH doors exist and
 * `door-aliases.test.ts` pins the retained aliases against the built `.d.ts`; this file
 * pins the NAMES behind every door, values and types alike, without a build, so a
 * relocation that drops, renames or adds an export fails here before it reaches `dist/`.
 *
 * WHAT A GREEN RUN PROVES: for every code entry in `package.json` `exports`, the TypeScript
 * checker's export list of the source module behind it equals the committed snapshot
 * (`door-surface.snapshot.json`), name for name.
 *
 * WHAT IT DOES NOT PROVE: that a name still means the same thing — a changed signature
 * behind an unchanged name passes. `tsc` and the behaviour suites own that.
 *
 * A DELIBERATE surface change updates the snapshot in the same change:
 * `npx vitest run test/api-conformance/door-surface.test.ts -u`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { require: { types: string } }>;
};

/** `./dist/types/doors/time.d.ts` → `src/doors/time.ts` — the source module behind a door. */
function sourceOf(door: string): string {
  const entry = PKG.exports[door];
  if (entry === undefined || typeof entry === 'string')
    throw new Error(`no code entry for "${door}"`);
  const match = /^\.\/dist\/types\/(.+)\.d\.ts$/.exec(entry.require.types);
  if (!match)
    throw new Error(`"${door}" declares types at an unexpected path: ${entry.require.types}`);
  return join(ROOT, 'src', `${match[1]}.ts`);
}

function doorSurface(): Record<string, string[]> {
  const doors = Object.keys(PKG.exports).filter((k) => typeof PKG.exports[k] !== 'string');
  const config = ts.getParsedCommandLineOfConfigFile(
    join(ROOT, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  );
  if (!config) throw new Error('tsconfig.json did not parse');
  const program = ts.createProgram(doors.map(sourceOf), { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();
  const surface: Record<string, string[]> = {};
  for (const door of doors.sort()) {
    const file = program.getSourceFile(sourceOf(door));
    const symbol = file && checker.getSymbolAtLocation(file);
    if (!symbol) throw new Error(`"${door}" resolved to a file with no module symbol`);
    surface[door] = checker
      .getExportsOfModule(symbol)
      .map((s) => s.getName())
      .sort();
  }
  return surface;
}

describe('door surface — the names behind every package.json door', () => {
  it('matches the committed snapshot, door for door, name for name', async () => {
    const surface = doorSurface();
    expect(Object.keys(surface).length).toBeGreaterThan(10);
    for (const names of Object.values(surface)) expect(names.length).toBeGreaterThan(0);
    await expect(`${JSON.stringify(surface, null, 2)}\n`).toMatchFileSnapshot(
      './door-surface.snapshot.json',
    );
  }, 120_000);
});
