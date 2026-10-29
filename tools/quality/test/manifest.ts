import { z } from "zod";

/** The parts of a `package.json` that the boundary tests read: every dependency field. */
export const Manifest = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  name: z.string().default(""),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
});
