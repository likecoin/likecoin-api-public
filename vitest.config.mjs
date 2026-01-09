import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@test': './test',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: ['dist/', 'node_modules/', '**/*.test.ts', 'test/setup.ts'],
    },
    setupFiles: ['./test/setup.ts'],
    testTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    reporters: ['default'],
    silent: false,
  },
});
