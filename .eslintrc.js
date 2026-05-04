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
