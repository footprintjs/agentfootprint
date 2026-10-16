// An engine or record door: `footprintjs`, `foottrace`, or a subpath of either (`footprintjs/trace`,
// `foottrace/write`, `foottrace/paths`), never a similarly prefixed package (`footprintjs-<other>`).
const DOOR = String.raw`/^(footprintjs|foottrace)(\/|$)/`;
const NAMED_IMPORTS_ONLY =
  'Import footprintjs and foottrace names by name, never off a namespace object (`import * as`, `export * as`, `import()`, `require()`, `import x = require()`): a name read off a namespace can leave its door with no type error (footprintjs trace-extraction plan, E2).';

const { layerZones } = require('./scripts/layering.config.cjs');

module.exports = {
  // Stop config resolution here. Without it, eslint walks UP the directory tree: a checkout
  // nested inside another checkout of this repo (a worktree under .claude/worktrees/) loads
  // BOTH copies of this file, and the `import` plugin, resolved from two node_modules, crashes
  // every lint run with "Cannot redefine plugin".
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  settings: {
    // The checker's own resolution law (`layering.config.cjs` · `resolveRelative`), so the lint
    // zones and `npm run check:layering` agree on which file every import names.
    'import/resolver': { [require.resolve('./scripts/eslint-import-resolver.cjs')]: {} },
  },
  rules: {
    // Keep the existing v5 policy while upgrading the parser/plugin. The v8 recommended
    // preset adds rules; those are separate policy decisions, not dependency fixes.
    '@typescript-eslint/no-require-imports': 'off',
    '@typescript-eslint/no-duplicate-enum-values': 'off',
    '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/adjacent-overload-signatures': 'error',
    '@typescript-eslint/no-inferrable-types': 'error',
    // ban-types was removed. Preserve its exact type-name bans, including `{}` in
    // intersections and locally shadowed names, which the new specialized rules exempt.
    '@typescript-eslint/no-restricted-types': [
      'error',
      {
        types: {
          String: { message: 'Use string instead', fixWith: 'string' },
          Boolean: { message: 'Use boolean instead', fixWith: 'boolean' },
          Number: { message: 'Use number instead', fixWith: 'number' },
          Symbol: { message: 'Use symbol instead', fixWith: 'symbol' },
          BigInt: { message: 'Use bigint instead', fixWith: 'bigint' },
          Function: true,
          Object: true,
          '{}': true,
        },
      },
    ],
    '@typescript-eslint/no-empty-interface': 'error',
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/no-unsafe-function-type': 'off',
    '@typescript-eslint/no-wrapper-object-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-empty-function': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    // Non-null-assertion enforced in SRC (each `!` justified inline via
    // eslint-disable-next-line with a reason, OR refactored to a guard).
    // Test files override below — `!` is idiomatic in test assertions
    // where a result has just been verified non-null.
    '@typescript-eslint/no-non-null-assertion': 'warn',
    // Core equivalents of the removed TS aliases, and the previous core overrides.
    'no-extra-semi': 'error',
    'no-empty-function': 'off',
    'no-class-assign': 'error',
    'no-with': 'error',
    'valid-typeof': 'off',
    'no-unused-vars': 'off',
    'no-use-before-define': 'off',
  },
  overrides: [
    {
      // ARCHITECTURE GUARDRAIL — the agentfootprint LIBRARY is UI-free. It must never import
      // a UI/render package. Those belong in the docs app (docs-next/) or the lens, which
      // consume agentfootprint — not the other way round. Keeping the library free of
      // React/flowchart deps is what lets docs-next import the lens render-only entry WITHOUT
      // pulling the engine into a browser bundle, and prevents an accidental dependency
      // inversion as more people contribute. See docs/design/ui-boundary.md.
      // Belt-and-suspenders: the package.json side is gated by
      // test/conventions/unit/no-ui-deps.test.ts (catches a forbidden *declared* dep).
      files: ['src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              'react',
              'react-dom',
              'next',
              'dagre',
              '@xyflow/react',
              'footprint-explainable-ui',
              'agentfootprint-lens',
            ].map((name) => ({
              name,
              message: `'${name}' is a UI/render dependency — the agentfootprint library is UI-free. Put UI code in docs-next/ or the lens; the library must not depend on it.`,
            })),
            patterns: [
              {
                group: ['react/*', 'react-dom/*', '@xyflow/*', 'footprint-explainable-ui/*', 'agentfootprint-lens/*', 'fumadocs*'],
                message: 'UI/render package — the agentfootprint library is UI-free (keep this in docs-next/ or the lens).',
              },
            ],
          },
        ],
        // NAMED IMPORTS ONLY from footprintjs and foottrace, subpaths included (footprintjs's
        // trace-extraction plan, step E2). A name read off a namespace object (`import * as`,
        // `export * as`, a value `import()` or `require()`, a template-literal specifier included,
        // or TypeScript's `import x = require()`) can be read through a cast and then leave its
        // door with no type error; the record's readers moved from footprintjs/trace to foottrace,
        // and a named import of a moved name fails tsc instead. A type query
        // `import('footprintjs').Name` is a named read (a TSImportType node) and stays allowed.
        // agentfootprint-lens holds the same rule as a test (test/packaging/named-imports.test.ts).
        'no-restricted-syntax': [
          'error',
          ...[
            `ImportDeclaration[source.value=${DOOR}] > ImportNamespaceSpecifier`,
            `ExportAllDeclaration[source.value=${DOOR}][exported]`,
            `ImportExpression[source.value=${DOOR}]`,
            `ImportExpression[source.type='TemplateLiteral'][source.quasis.0.value.cooked=${DOOR}]`,
            `CallExpression[callee.name='require'][arguments.0.value=${DOOR}]`,
            `CallExpression[callee.name='require'][arguments.0.type='TemplateLiteral'][arguments.0.quasis.0.value.cooked=${DOOR}]`,
            `TSImportEqualsDeclaration > TSExternalModuleReference[expression.value=${DOOR}]`,
          ].map((selector) => ({ selector, message: NAMED_IMPORTS_ONLY })),
        ],
      },
    },
    {
      // THE FENCE (src only — tests import whatever they test). The layer table lives in
      // scripts/layering.config.cjs; `layerZones` turns it into zones, so the table has one
      // owner and `npm run check:layering` reads the same one: a file imports only its own
      // layer or below. This rule cannot tell `import type` from a runtime import, so the
      // upward type-only imports named in TYPE_ONLY_ALLOWANCES are cut out of the zones; the
      // checker keeps each one type-only and fails on any new one.
      files: ['src/**/*.ts'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          { basePath: __dirname, zones: layerZones(__dirname) },
        ],
      },
    },
    {
      files: ['test/**/*.ts', '**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        // `!` after `expect(x).toBeDefined()` and similar is idiomatic
        // in test assertions; the test framework guarantees the value
        // by the time the next line accesses it. Off for tests only.
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
