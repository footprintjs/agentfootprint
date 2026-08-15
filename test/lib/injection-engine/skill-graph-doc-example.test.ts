/**
 * The `/skill-graph` door's `@example` is CHECKED CODE, not prose.
 *
 * Doc comments are emitted into the declaration files, so the `@example` in
 * `src/doors/skill-graph.ts` ships in `dist/types/doors/skill-graph.d.ts` and
 * `dist/esm/doors/skill-graph.d.ts` — it is what a consumer reads on hover.
 * The one that shipped before this file existed was wrong three ways over: it
 * passed `entry:` (the flat config's key is `start`), chained `.route()` and
 * `.build()` off the finished `SkillGraph` that `skillGraph(config)` returns,
 * and passed skill IDS to a `.route()` whose parameters are skill OBJECTS.
 * Every one of those is a compile error; nothing compiled it, so nothing said
 * so, for as many releases as it took someone to read it.
 *
 * TypeScript does not typecheck doc comments and this repo has no twoslash
 * over `src/**`, so the fix is indirection: the sample LIVES in an example
 * file, where `npm run test:examples:typecheck` compiles it and
 * `scripts/run-all-examples.sh` executes it, and this test pins the docblock
 * to it byte-for-byte. The docblock cannot rot without failing here, and it
 * cannot be right-but-stale either — the pin is equality, not similarity.
 *
 * ONE difference is allowed, and it is the reason this is a comparison rather
 * than a generator: an example imports `../../src/doors/skill-graph.js` (so it
 * compiles against the working tree), while the docblock must show the
 * specifier a CONSUMER writes. That specifier is not merely trusted — the last
 * assertion checks it against package.json `exports`, which is the same
 * surface `test/esm-packaging.test.ts` loads.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DOOR = resolve(repoRoot, 'src/doors/skill-graph.ts');
const EXAMPLE = resolve(repoRoot, 'examples/context-engineering/19-skill-graph-host.ts');

/** The specifier the example compiles against… */
const SOURCE_SPECIFIER = "'../../src/doors/skill-graph.js'";
/** …and the one a consumer writes, which the docblock must show instead. */
const CONSUMER_SPECIFIER = 'agentfootprint/skill-graph';

/** The `doc-example` region of the example file — the checked original. */
function checkedSample(): string {
  const src = readFileSync(EXAMPLE, 'utf8');
  const match = src.match(/\/\/ #region doc-example\n([\s\S]*?)\n\/\/ #endregion doc-example/);
  if (!match) throw new Error(`no #region doc-example in ${EXAMPLE}`);
  return match[1]!.replace(SOURCE_SPECIFIER, `'${CONSUMER_SPECIFIER}'`);
}

/**
 * The fenced `ts` block of the door's `@example`, with the JSDoc gutter
 * removed. ` * ` for a content line, a bare ` *` for a blank one — strip
 * exactly those two, so a stray indentation change is a failure rather than
 * something the reader silently absorbs.
 */
function docblockSample(): string {
  const src = readFileSync(DOOR, 'utf8');
  const blocks = [...src.matchAll(/@example[^\n]*\n \* ```ts\n([\s\S]*?)\n \* ```/g)];
  // Exactly one: a second `@example` added above this one would make the pin
  // silently guard the wrong block, and a pin that guards the wrong thing is
  // worse than none. Add examples to the example FILE, not to the docblock.
  if (blocks.length !== 1) {
    throw new Error(`expected exactly 1 fenced @example in ${DOOR}, found ${blocks.length}`);
  }
  return blocks[0]![1]!
    .split('\n')
    .map((line) => (line === ' *' ? '' : line.replace(/^ \* /, '')))
    .join('\n');
}

describe("the /skill-graph door's shipped @example", () => {
  it('is byte-identical to the compiled, executed sample', () => {
    // Not `toEqual` on split lines: the whole point is that what ships on
    // hover and what the compiler proved are the same characters.
    expect(docblockSample()).toBe(checkedSample());
  });

  it('shows the consumer specifier, and that subpath really is exported', () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const subpath = './' + CONSUMER_SPECIFIER.slice('agentfootprint/'.length);
    expect(Object.keys(pkg.exports)).toContain(subpath);
    expect(docblockSample()).toContain(`from '${CONSUMER_SPECIFIER}';`);
  });

  it('is a whole program — every symbol it names comes from that one import', () => {
    // The old example leaned on a `ctx` and a `skills` that appeared from
    // nowhere, which is how a reader ends up inventing the rest. Anything the
    // sample uses, the sample declares.
    const sample = checkedSample();
    for (const declared of ['const triage', 'const billing', 'const graph', 'const ctx']) {
      expect(sample).toContain(declared);
    }
    // The builder is entered by the no-argument overload and left by
    // `.build()` — the two halves the broken example had backwards.
    expect(sample).toContain('skillGraph()');
    expect(sample).toContain('.build();');
  });
});
