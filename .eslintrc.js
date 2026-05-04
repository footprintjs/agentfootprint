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
    // Non-null-assertion (`!`) is idiomatic in this codebase for two
    // patterns where the project has chosen to favor readability over
    // exhaustive type narrowing:
    //   1. Tests: asserting on values known to exist after a check.
    //   2. Source: post-condition guarantees inside well-typed maps
    //      (e.g., `registryByName.get(name)!` after we've just put it in,
    //      or `buildReadSkillTool(skills)!` guarded by length check above).
    // 359 warnings under the recommended preset = consistently ignored.
    // Either tighten with proper type guards (large refactor across the
    // suite) OR turn off and rely on tsc + tests to catch real undefined
    // dereferences. We choose the latter — same effective safety, less noise.
    '@typescript-eslint/no-non-null-assertion': 'off',
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
      },
    },
  ],
};
