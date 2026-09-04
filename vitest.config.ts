import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node by default — the domain and service tests need nothing else. React
    // tests opt into jsdom with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
