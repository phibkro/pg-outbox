import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import { checkHealth } from "./remote.ts";

export interface Workerd {
  /** `http://127.0.0.1:<port>`: `GET /health`. */
  readonly baseUrl: string;
  /** `ws://127.0.0.1:<port>/session`: what a runner opens sessions on. */
  readonly sessionUrl: string;
  readonly stop: () => void;
}

const here = path.dirname(new URL(import.meta.url).pathname);

/**
 * The real Worker (`worker.ts`, bundled by wrangler) under workerd on this machine, with a local Hyperdrive binding that points at
 * `connectionString`. It is the Worker's own code in the Workers runtime; it is not Hyperdrive and not Cloudflare's network.
 * wrangler refuses a local Hyperdrive string without a password, so one is added: a test server trusts every connection.
 */
export const startWorkerd = async (options: {
  readonly connectionString: string;
  readonly token: string;
  readonly port: number;
}): Promise<Workerd> => {
  const local = new URL(options.connectionString);

  local.password = "local";

  const wrangler = spawn(
    "bunx",
    [
      "wrangler@4.156.0",
      "dev",
      "--config",
      path.join(here, "../scripts/wrangler.dev.jsonc"),
      "--port",
      String(options.port),
      "--var",
      `PROBE_TOKEN:${options.token}`,
    ],
    {
      env: {
        ...process.env,
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
          local.toString(),
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let log = "";

  const collect = (chunk: Uint8Array): void => {
    log += new TextDecoder().decode(chunk);
  };

  wrangler.stdout.on("data", collect);
  wrangler.stderr.on("data", collect);

  const baseUrl = `http://127.0.0.1:${options.port}`;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await setTimeout(500);

    try {
      await checkHealth(baseUrl, options.token);

      return {
        baseUrl,
        sessionUrl: `ws://127.0.0.1:${options.port}/session`,
        stop: () => {
          wrangler.kill("SIGTERM");
        },
      };
    } catch {
      // wrangler is still starting
    }
  }

  wrangler.kill("SIGTERM");

  throw new Error(
    `the Worker never answered /health under workerd; wrangler said:\n${log}`
  );
};
