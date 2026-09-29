import * as docker from "./backends/docker.ts";
import * as neon from "./backends/neon.ts";
import * as server from "./backends/server.ts";
import {
  API_ENV,
  loadContext,
  readFlags,
  resolveState,
  run,
  say,
} from "./lib/context.ts";
import { removeKey, writeEnvFile } from "./lib/env-file.ts";
import { BACKEND_LABEL } from "./lib/state.ts";

// `pnpm db:drop`: drop the development database this checkout uses, then remove its state
// block and `DATABASE_URL` from `apps/api/.dev.vars`.
//
// It drops a database and never a server: no container is stopped, no neon.new project and
// no Postgres instance is removed. `docker compose down -v` is the separate, manual step
// that throws the container away.
//
// There is no confirmation prompt and no `--yes`. Safety here is a refusal: `resolveState`
// throws on a `DATABASE_URL` the state block does not vouch for, and `assertManagedDatabase`
// guards the name before it reaches the server.

await run(async () => {
  readFlags([]);
  const context = loadContext();
  const state = resolveState(context);
  if (!state) {
    say("This checkout has no development database. Nothing to drop.");
    return;
  }

  const url = context.env.values.get("DATABASE_URL");
  if (state.backend === "neon") {
    if (!url) {
      throw new Error(
        `The state block names ${state.database} on neon.new, but ${API_ENV} has no DATABASE_URL to reach it with. Remove the block by hand.`
      );
    }
    neon.forceIpv4();
    await neon.dropDatabase(context.prefix, url, state.database);
  } else {
    const admin =
      state.backend === "docker" ? docker.adminUrl() : server.adminUrl(url);
    await server.dropDatabase(context.prefix, admin, state.database);
  }

  writeEnvFile(
    context.env.path,
    [],
    removeKey(context.env.lines, "DATABASE_URL")
  );
  say(
    `Dropped ${state.database} on ${BACKEND_LABEL[state.backend]}, and removed its state block and DATABASE_URL from ${API_ENV}.`
  );
  if (state.backend === "docker") {
    say(
      "The container is still running. docker compose down -v in the repo root removes it and its volume."
    );
  }
});
