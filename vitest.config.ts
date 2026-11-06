import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Shared CI runners (macOS especially) sometimes stall for many seconds.
    // Setup hooks crawl and audit fixture sites, so give them room.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
