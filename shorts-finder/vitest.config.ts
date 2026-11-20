import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The list of exports and type-only files have nothing to execute under
      // test. The two programs (`main.ts`, `cli.ts`) only join `service.ts` and
      // `cli/run.ts`, which are tested, to the process: its settings, signals
      // and terminal. They are run by hand; see the README.
      exclude: ['src/index.ts', 'src/**/types.ts', 'src/main.ts', 'src/cli.ts'],
      reporter: ['text'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
