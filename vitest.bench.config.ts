import { defineConfig } from 'vitest/config';

/** Mesures de performance (npm run bench) : exécutées seules, un fichier à la fois. */
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.test.ts'],
    environment: 'node',
    testTimeout: 900_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
