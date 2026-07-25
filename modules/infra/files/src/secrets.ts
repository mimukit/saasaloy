import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { DiscoveredService } from "./discover.js";

/**
 * Push Worker secrets from a `.env` file straight through to Cloudflare via `wrangler
 * secret put`, entirely outside Pulumi (ADR 0021: secrets never enter Pulumi
 * config/state, since state is committed in-repo). A key already declared as a plain
 * `vars` binding in the service's wrangler.jsonc is skipped — that one is non-secret
 * and already flows through `translate.ts`'s bindings; anything else in `.env` is
 * treated as a secret for that service.
 */
export async function pushSecrets(service: DiscoveredService, envPath = ".env"): Promise<void> {
  const source = await readFile(envPath, "utf8").catch(() => null);
  if (source === null) {
    console.log(`infra: no ${envPath} found — skipping secrets for ${service.name}.`);
    return;
  }

  const varKeys = new Set(Object.keys(service.config.vars ?? {}));
  const entries = parseEnv(source).filter(([key]) => !varKeys.has(key));

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
