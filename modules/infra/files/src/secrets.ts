import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { DiscoveredService } from "./discover.js";

// infra's own deploy credentials (see the saasaloy-infra skill's "Credentials setup").
// Users commonly keep these in the same `infra/.env` that also holds Worker secrets
// (direnv, `source .env`, etc.) — never push them to a Worker's secret store, or every
// deployed service would receive the Cloudflare API token / account id / Pulumi
// passphrase that's meant to stay with the deploy tooling only. `PULUMI_*` and
// `CLOUDFLARE_*` are blocked wholesale (reserved prefixes for this tool and its
// provider) so a future infra-only env var doesn't need a denylist update to stay safe.
const INFRA_CREDENTIAL_KEYS = new Set([
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_DEFAULT_ACCOUNT_ID",
  "PULUMI_CONFIG_PASSPHRASE",
]);
const INFRA_CREDENTIAL_PREFIXES = ["PULUMI_", "CLOUDFLARE_"];

function isInfraCredential(key: string): boolean {
  return (
    INFRA_CREDENTIAL_KEYS.has(key) || INFRA_CREDENTIAL_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Push Worker secrets from a `.env` file straight through to Cloudflare via `wrangler
 * secret put`, entirely outside Pulumi (ADR 0021: secrets never enter Pulumi
 * config/state, since state is committed in-repo). A key already declared as a plain
 * `vars` binding in the service's wrangler.jsonc is skipped — that one is non-secret
 * and already flows through `translate.ts`'s bindings. A key that matches
 * `isInfraCredential` (infra's own deploy credentials, e.g. CLOUDFLARE_API_TOKEN) is
 * also skipped, unconditionally — those belong to the deploy tooling, never to a
 * deployed Worker. Everything else in `.env` is treated as a secret for that service.
 */
export async function pushSecrets(service: DiscoveredService, envPath = ".env"): Promise<void> {
  const source = await readFile(envPath, "utf8").catch(() => null);
  if (source === null) {
    console.log(`infra: no ${envPath} found — skipping secrets for ${service.name}.`);
    return;
  }

  const varKeys = new Set(Object.keys(service.config.vars ?? {}));
  const entries = parseEnv(source).filter(
    ([key]) => !varKeys.has(key) && !isInfraCredential(key),
  );

  for (const [key, value] of entries) {
    console.log(`infra: pushing secret ${key} for ${service.name}...`);
    await putSecret(service.dir, key, value);
  }
}

function parseEnv(source: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    entries.push([key, value]);
  }
  return entries;
}

// `wrangler secret put <key>` reads the value from stdin — never a CLI argument, so a
// secret never lands in shell history or a process list.
function putSecret(dir: string, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("wrangler", ["secret", "put", key], {
      cwd: dir,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`infra: "wrangler secret put ${key}" failed (exit ${code}) in ${dir}`));
    });
    child.stdin.write(value);
    child.stdin.end();
  });
}
