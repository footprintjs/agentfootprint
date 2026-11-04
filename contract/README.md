# Foottrace consumer contract

Run the consumer's narrow upstream gate with:

```sh
npm ci
npm ls foottrace
npm run test:contract:foottrace
```

It reads the installed `foottrace` package. To test an upstream tarball, stage it
explicitly after the locked install (without changing the lockfile), then use the
same command:

```sh
npm install --no-save --package-lock=false --ignore-scripts /absolute/path/foottrace.tgz
npm run test:contract:foottrace
```

The suite parses every TypeScript file under `src/`, rather than using a saved
API inventory. Every imported or re-exported runtime symbol must have one named
behavior contract; removed imports also fail until their obsolete contract is
removed. Aliases keep the exported name. New namespace/default/dynamic/import-type
forms are refused until their surface has explicit coverage.

All source-imported symbols, including type-only imports, are compiled against
both the installed CommonJS and ESM declaration entry points. Runtime behaviors
run independently through both public formats. The tests cover this consumer's
replay/value basis, backward and forward slices, key timelines, read-source
strategies, stage identifiers, stop filtering, range indexing, requirement-result
admission and `/cause` graph/explanation reads. Saved-record loading belongs to
this consumer's `footprintjs/trace` imports; it does not import Foottrace's
`readStoredRecord`, so that unrelated door is deliberately outside this suite.

`foottrace.install.mjs` also resolves Foottrace from this consumer and from
Footprint's installed entry, then compares their real paths. Both must use one
physical record-library image; matching version strings or file bytes alone do
not establish that. Symlink aliases to the same physical image are accepted.
The adjacent controls use inert same-version/same-byte package fixtures and
demonstrate the actual nested resolution before checking its refusal. This is a
new assertion, not a claim that the previous contract suite detected duplicates.

CI records `npm ls foottrace` immediately after the locked install, then runs
this command on Node 22 and 24 in the `test-package` job. The real-path check
measures the currently installed dependency image; a separately preserved local
development image is not evidence of a fresh locked install. This gate does not
build or test the upstream repository, change a dependency version, or publish a
package.
