import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Postgres-backed store integration tests share the `memind` database.
    // Running multiple test files in parallel causes `TRUNCATE` calls from
    // one file to wipe the seeded state of another. Serialise the whole
    // server suite onto a single worker — the suite finishes in under 10s
    // regardless, so the throughput loss is acceptable.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
