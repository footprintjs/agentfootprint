import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
  resolve: {
    // footprintjs (peer-dep) declares `zod` as an OPTIONAL peer-dep.
    // Vite's resolver auto-stubs optional peer-deps under the
    // `__vite-optional-peer-dep:` prefix EVEN WHEN the consumer has
    // it installed. `dedupe` forces vitest to resolve every `zod`
    // import against the SINGLE installed copy in this repo's
    // node_modules, bypassing the optional-peer stub.
    dedupe: ['zod'],
  },
});
