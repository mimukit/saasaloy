import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// `cloudflare:workers` for the api's tests, which run in Node. `vitest.config.ts` aliases
// the module id here.
//
// The Workers runtime fills `env` from the bindings and from `apps/api/.env` in local
// development. Here it is that file's values and nothing else, so a module that reads a key
// at import time sees the same value it would under `vite dev`. A request still gets its
// bindings from the `env` argument a test passes to `app.request`, never from here.
//
// Run `pnpm env:setup` when a test fails on a missing key: it writes `apps/api/.env`.

const envFile = new URL("../.env", import.meta.url);

export const env: Record<string, string | undefined> = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, "utf-8"))
  : {};
