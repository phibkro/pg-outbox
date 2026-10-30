import { defineConfig } from "vite-plus";

// The run through a Worker: `bun run probe local` and `bun run probe run` (never `bun run test`). A statement through Hyperdrive
// costs a round trip, so the limits are those of a slow remote database.
export default defineConfig({
  test: {
    hookTimeout: 180_000,
    include: ["test/hyperdrive.test.ts"],
    testTimeout: 600_000,
  },
});
