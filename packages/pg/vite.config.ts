import { defineConfig } from "vite-plus";

// Each test file starts its own PostgreSQL (and PgBouncer) on free ports.
export default defineConfig({
  test: {
    hookTimeout: 120_000,
    include: ["test/**/*.test.ts"],
    testTimeout: 300_000,
  },
});
