/**
 * THE WALK — every folder under `src/` says which of the five roles it plays.
 *
 * The five roles are Map (what could happen), Walker (what is happening),
 * Trace (what happened and why), Fold (what may be claimed now) and Lens (what
 * THIS reader is served — for this library, the wire). A folder that carries
 * more than one says `Mixed` and names them. The vocabulary and this library's
 * folder-by-folder assignment live in
 * `docs/design/map-walker-trace-fold-lens.md`.
 *
 * WHY A TEST. The defect this whole pass exists to prevent was not a missing
 * page: it was three composers re-deriving facts a Fold already owned, in files
 * where nothing said which of them was a Lens. A page can be written once and
 * left behind by the tree. A test fails when a new folder arrives without an
 * answer.
 *
 * WHAT A GREEN RUN PROVES: every non-empty directory under `src/` has a
 * `README.md` whose first non-empty line names exactly one role word, and every
 * `Mixed` one names at least two roles in its opening paragraph. That is a
 * CLAIM being present and well-formed.
 *
 * WHAT A GREEN RUN DOES NOT PROVE: that the claim is TRUE, with ONE exception.
 * Nothing here reads a line of TypeScript, so a folder full of Lens composers
 * that says `Fold` still passes — the reviewer checks truth, this test checks
 * that there is something to check. The exception is `Support`, which is the
 * only role word that is a claim of ABSENCE ("it decides nothing about what the
 * model may see") and therefore the only one a cheap check can refute: the last
 * block below fails if any file registered in `test/modelFacingSurfaces.test.ts`
 * lives in a folder whose README opens with `Support`. That closes the free pass
 * — `Support` was taken by 39 of 99 folders, and a Lens hiding under it is
 * exactly the state this pass exists to make impossible.
 *
 * Two neighbouring tests carry the rest of the truth: the fence test
 * (`test/lib/injection-engine/skill-graph-fence.test.ts`) proves an import
 * boundary, `test/architecture/citations.test.ts` proves the role headers'
 * pointers still point at something, and `test/modelFacingSurfaces.test.ts`
 * pins the registered model-facing producers themselves.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

/** The five roles, plus `Mixed` for a folder that carries several and `Support` for one that carries none. */
const ROLE_WORDS = ['Map', 'Walker', 'Trace', 'Fold', 'Lens', 'Mixed', 'Support'] as const;
const ROLE_RE = new RegExp(`\\b(${ROLE_WORDS.join('|')})\\b`, 'g');

/** Skipped: test fixtures live beside their subject in some trees, and an empty directory has nothing to describe. */
const SKIP_DIR = new Set(['__tests__', '__fixtures__', 'node_modules']);

function directories(dir: string): string[] {
  const here: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const hasEntries = entries.length > 0;
  if (hasEntries) here.push(dir);
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIR.has(entry.name)) continue;
    here.push(...directories(join(dir, entry.name)));
  }
  return here.filter((d, i, all) => all.indexOf(d) === i);
}

/** The first non-empty line, and the paragraph it opens (up to the first blank line). */
function opening(text: string): { firstLine: string; paragraph: string } {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() !== '');
  if (start === -1) return { firstLine: '', paragraph: '' };
  const end = lines.findIndex((l, i) => i > start && l.trim() === '');
  const paragraph = lines.slice(start, end === -1 ? lines.length : end);
  return { firstLine: lines[start]!.trim(), paragraph: paragraph.join(' ') };
}

function rolesIn(s: string): string[] {
  return [...new Set(s.match(ROLE_RE) ?? [])];
}

describe('every src/ folder claims a role', () => {
  const dirs = directories(SRC);

  it('finds the tree', () => {
    expect(dirs.length).toBeGreaterThan(50);
  });

  for (const dir of dirs) {
    const label = relative(join(SRC, '..'), dir);

    it(`${label} has a README.md whose first line names one role`, () => {
      const readme = join(dir, 'README.md');
      let text: string;
      try {
        statSync(readme);
        text = readFileSync(readme, 'utf8');
      } catch {
        throw new Error(
          `${label} has no README.md. Every folder under src/ opens with its role: ` +
            `**Map** | **Walker** | **Trace** | **Fold** | **Lens** | **Mixed** | **Support** ` +
            `plus one true sentence. See docs/design/map-walker-trace-fold-lens.md.`,
        );
      }

      const { firstLine, paragraph } = opening(text);
      const named = rolesIn(firstLine);

      expect(
        named.length,
        `${label}/README.md must open with exactly ONE role word, and its first line names ` +
          `${named.length === 0 ? 'none' : named.join(' + ')}: "${firstLine}"`,
      ).toBe(1);

      if (named[0] === 'Mixed') {
        const inParagraph = rolesIn(paragraph).filter((r) => r !== 'Mixed');
        expect(
          inParagraph.length,
          `${label}/README.md says Mixed, so its opening paragraph must name at least TWO of ` +
            `Map/Walker/Trace/Fold/Lens/Support and which files carry them; it names ` +
            `${inParagraph.length === 0 ? 'none' : inParagraph.join(' + ')}.`,
        ).toBeGreaterThanOrEqual(2);
      }
    });
  }
});

/**
 * The one claim in this file that is checked against the code rather than
 * against the prose. `Support` says "it decides nothing about what the model may
 * see"; `test/modelFacingSurfaces.test.ts` is the register of the files that DO.
 * The two lists may not intersect.
 *
 * HOW WEAK THIS ASSERTION IS, STATED SO NOBODY READS IT AS COVER. The register
 * it consults is HAND-MAINTAINED and holds ten modules, every one of them
 * already inside a **Mixed** or **Lens** folder — so this runs green because its
 * input is nearly empty, not because Support has been proved clean. The same is
 * true of the other hand-maintained register next door: `LEDGER` in
 * `test/modelFacingScan.test.ts` files only surfaces whose prose carries a
 * `this run` / `right now` time anchor, which is what its scan keys on. It was
 * never a census of model-facing files, and a guard keyed to it inherits that
 * blind spot: it would not have caught `src/patterns/LlmRouter.ts`,
 * `src/lib/injection-engine/constrainedEnumPick.ts`,
 * `src/lib/injection-engine/llmClassifier.ts`, `src/memory/beats/llmExtractor.ts`,
 * `src/memory/pipeline/auto.ts`, `src/core-flow/Parallel.ts`, or any of the four
 * integrity checks retracted to Mixed in this pass — none of them carries a
 * LEDGER row. So do NOT extend this by keying a new guard to either register.
 * The signal has to be DERIVED from the source: a file that builds a
 * `{ role: 'system' | 'user', content }` message the library owns, assigns
 * `scope.formatted`, or sets `message:` on a `ContextError` is model-facing
 * whether or not a human remembered to register it, and its nearest README must
 * open **Lens** or **Mixed** and name it. Grow the register from what such a
 * scan finds; until then this assertion is a floor, not a proof.
 */
describe('Support is the one role word that can be refuted, and it is', () => {
  /** `module:` paths from the model-facing register, read as text so this test
   *  never imports (and therefore never runs) the producers themselves. */
  const registeredModules = (): readonly string[] => {
    const register = readFileSync(join(SRC, '..', 'test', 'modelFacingSurfaces.test.ts'), 'utf8');
    return [...new Set([...register.matchAll(/module:\s*'(src\/[^']+)'/g)].map((m) => m[1]!))];
  };

  /** The role word a file's OWN folder claims — the nearest README, not a parent. */
  const roleOf = (modulePath: string): string | undefined => {
    const readme = join(SRC, '..', modulePath.slice(0, modulePath.lastIndexOf('/')), 'README.md');
    try {
      statSync(readme);
    } catch {
      return undefined;
    }
    return rolesIn(opening(readFileSync(readme, 'utf8')).firstLine)[0];
  };

  it('finds the register', () => {
    expect(registeredModules().length).toBeGreaterThan(5);
  });

  it('registers no model-facing producer in a Support folder', () => {
    const hidden = registeredModules()
      .filter((m) => roleOf(m) === 'Support')
      .map((m) => `${m} composes a model-facing sentence, but its folder README opens **Support**`);
    expect(
      hidden,
      `A folder that says Support claims it decides nothing about what the model may see. ` +
        `Either the role word is wrong (say Lens, or Mixed and name the Lens files), or the ` +
        `producer belongs in a folder that already carries the role.\n\n${hidden.join('\n')}`,
    ).toEqual([]);
  });
});
