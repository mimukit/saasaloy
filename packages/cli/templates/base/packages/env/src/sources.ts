import path from "node:path";
import { EnvError } from "./error.ts";
import { readEnvFile } from "./env-file.ts";
import { parseValues } from "./dotenv.ts";
import { readExample } from "./example.ts";
import { LOCAL_PROD_VALUES, LOCAL_VALUES } from "./services.ts";
import type { EnvSource } from "./source.ts";

// Where `pnpm env:setup` gets its values. A source is vendor-blind from here: it takes a
// service and an environment, and it answers with a key-value map or it throws one of the
// normalized errors below.
//
// The built-in `local` source reads the gitignored `packages/env/.env`, the file
// `saasaloy env` prompts into, so a project distributes values with no vendor account and
// no network. For production it reads `packages/env/.env.prod` instead, which you fill in
// by hand. `saasaloy add env-infisical` registers a second source.

export { EnvError } from "./error.ts";
export type { EnvErrorCode, EnvErrorOptions } from "./error.ts";

export type { EnvSource, LoadRequest } from "./source.ts";

export interface SourceRegistry {
  sources: EnvSource[];
  /** The source `ENV_SOURCE` names, or `local` when it is unset. */
  select(name?: string): EnvSource;
}

/**
 * The built-in source. It reads one gitignored file for every service, so a key two
 * services share is typed once: `packages/env/.env` for `dev` and `packages/env/.env.prod`
 * for `prod`. Two files, so a deploy never ships a `localhost` URL by accident.
 *
 * It answers with the keys `packages/env/.env.example` lists for *this* service, and no
 * others. The one file holds every project value, and the example's `# @services` lines
 * are what say who reads each one — without this narrowing, a browser bundle's `.env`
 * would carry the api's secrets.
 */
export const local: EnvSource = {
  name: "local",
  async load(request) {
    const relative =
      request.environment === "prod" ? LOCAL_PROD_VALUES : LOCAL_VALUES;
    const held = readEnvFile(path.join(request.root, relative));
    if (!held.exists) {
      throw new EnvError(
        request.environment === "prod"
          ? `${LOCAL_PROD_VALUES} does not exist, so the local source has no production values. Copy the keys from packages/env/.env.example into it and set the production value of each.`
          : `${LOCAL_VALUES} does not exist, so the local source has no values. Run saasaloy env to fill it in.`,
        { code: "not_configured" }
      );
    }
    // A key the file does not hold at all takes the example's default, so a checkout made
    // before a module added that key still passes `env:setup`. A key the file holds blank
    // stays blank: that is a choice, and the check still reports it. Production takes no
    // default, because a dev default such as a `localhost` URL is never a production value.
    const takeDefaults = request.environment !== "prod";
    const mine = new Map<string, string>();
    for (const [key, fallback] of parseValues(
      readExample(request.root, request.service.name)
    )) {
      const value =
        held.values.get(key) ??
        (takeDefaults && fallback !== "" ? fallback : undefined);
      if (value !== undefined) {
        mine.set(key, value);
      }
    }
    return await Promise.resolve(mine);
  },
};

/**
 * Keep this line in exactly this shape: `export const sources = defineSources({ sources: [...] })`
 * with a real array literal. The codemod behind the `plugin-array` patch kind has nothing
 * to push into otherwise, and `saasaloy add env-infisical` fails silently.
 */
export function defineSources(config: {
  sources: EnvSource[];
}): SourceRegistry {
  const all = [local, ...config.sources];
  return {
    sources: all,
    select(name) {
      const wanted = name ?? local.name;
      const found = all.find((source) => source.name === wanted);
      if (!found) {
        throw new EnvError(
          `ENV_SOURCE is ${wanted}, which is not an installed value source. Installed: ${all
            .map((source) => source.name)
            .join(", ")}.`,
          { code: "not_configured" }
        );
      }
      return found;
    },
  };
}

export const sources = defineSources({ sources: [] });
