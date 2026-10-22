import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Integration suites share one test database.
    fileParallelism: false,
    // Simulated weeks run hundreds of HTTP requests against PostgreSQL.
    testTimeout: 60_000,
  },
});
