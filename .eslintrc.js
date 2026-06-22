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
