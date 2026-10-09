// A footprintjs door: `footprintjs` or `footprintjs/<subpath>`, never `footprintjs-<other>`.
const FOOTPRINTJS_DOOR = String.raw`/^footprintjs(\/|$)/`;
const NAMED_FOOTPRINTJS_ONLY =
  'Import footprintjs names by name, never off a namespace object (`import * as`, `import()`, `require()`): a name read off a namespace can leave its door with no type error (footprintjs trace-extraction plan, E2).';

module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-empty-function': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // Non-null-assertion enforced in SRC (each `!` justified inline via
    // eslint-disable-next-line with a reason, OR refactored to a guard).
    // Test files override below — `!` is idiomatic in test assertions
    // where a result has just been verified non-null.
    '@typescript-eslint/no-non-null-assertion': 'warn',
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
        // NAMED IMPORTS ONLY from footprintjs (footprintjs's trace-extraction plan, step E2).
        // A name read off a namespace object (`import * as`, a value `import()` or `require()`)
        // can be read through a cast and then leave its door with no type error; the record's
        // readers are leaving footprintjs/trace for a package of their own, and a named import
        // of a moved name fails tsc instead. A type query `import('footprintjs').Name` is a named
        // read (a TSImportType node) and stays allowed. agentfootprint-lens holds the same rule
        // as a test (test/packaging/named-imports.test.ts).
        'no-restricted-syntax': [
          'error',
          ...[
            `ImportDeclaration[source.value=${FOOTPRINTJS_DOOR}] > ImportNamespaceSpecifier`,
            `ImportExpression[source.value=${FOOTPRINTJS_DOOR}]`,
            `CallExpression[callee.name='require'][arguments.0.value=${FOOTPRINTJS_DOOR}]`,
          ].map((selector) => ({ selector, message: NAMED_FOOTPRINTJS_ONLY })),
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
