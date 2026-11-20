import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/lib/**/*.ts'],
      // Entry points and type-only files have nothing to execute under test.
      exclude: [
        'packages/*/src/cli.ts',
        'packages/*/src/index.ts',
        'packages/*/src/**/types.ts',
        // Process entry points and wiring: exercised by running the server.
        'packages/server/src/main.ts',
        'packages/server/src/engine.ts',
      ],
      reporter: ['text'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
