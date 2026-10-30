import { defineConfig } from "vite-plus";

// `local.test.ts` starts its own PostgreSQL on a free port. `hyperdrive.test.ts` needs a deployed Worker and runs only through
// `bun run probe` (vite.probe.config.ts), never as part of `bun run test`.
export default defineConfig({
  test: {
    exclude: ["test/hyperdrive.test.ts"],
    hookTimeout: 120_000,
    include: ["test/**/*.test.ts"],
    testTimeout: 300_000,
  },
});
