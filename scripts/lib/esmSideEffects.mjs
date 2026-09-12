/**
 * esmSideEffects — the `sideEffects` list the ESM build ships, derived from
 * the root package.json's list.
 *
 * A bundler reads `sideEffects` from the CLOSEST package.json to the module it
 * is deciding about, and `dist/esm/package.json` (written by
 * scripts/postbuild-esm.mjs to mark the build `type:module`) is that file for
 * every ESM module. Entries are matched relative to the package.json that
 * declares them, so the root's `./dist/esm/…` entries are rebased to `./…`,
 * its `./dist/…` entries (the CJS build) do not apply, and double-star globs
 * (`**` + `/…`) carry as written. One derivation, used by the build AND pinned by
 * test/esm-packaging.test.ts, so the shipped file cannot drift from the root.
 */
export function esmSideEffects(rootSideEffects) {
  if (!Array.isArray(rootSideEffects)) {
    throw new Error(
      'esmSideEffects: root package.json must declare `sideEffects` as a list — the ESM build ' +
        'would otherwise ship without one and every bundler would keep every module it can reach.',
    );
  }
  return rootSideEffects.flatMap((entry) => {
    if (entry.startsWith('./dist/esm/')) return [`./${entry.slice('./dist/esm/'.length)}`];
    if (entry.startsWith('./dist/')) return [];
    return [entry];
  });
}
