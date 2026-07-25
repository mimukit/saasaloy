import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import * as cloudflare from "@pulumi/cloudflare";
import type * as pulumi from "@pulumi/pulumi";
import type { DiscoveredService, WranglerConfig } from "./discover.js";

const execFileAsync = promisify(execFile);

// wrangler.jsonc keys every shipped service carries that describe the Worker itself,
// never a binding to translate — anything else falls through to the loud-fail default.
const NON_BINDING_KEYS = new Set([
  "$schema",
  "name",
  "main",
  "compatibility_date",
  "compatibility_flags",
]);

export interface ServiceResources {
  /** The deployed Worker script. */
  script: cloudflare.WorkersScript;
  /** D1 databases provisioned for this service, one per `d1_databases` entry. */
  databases: cloudflare.D1Database[];
  /** Enables the service on `<script>.<account-subdomain>.workers.dev`. */
  subdomain: cloudflare.WorkersScriptSubdomain;
}

/**
 * Translate one discovered service's wrangler.jsonc into Cloudflare Pulumi resources
 * (ADR 0021's translation layer — the maintained core of `infra`). Builds the service,
 * provisions a D1Database per `d1_databases` entry, maps `vars` to plain-text bindings,
 * and deploys the built bundle as a WorkersScript. Any binding kind beyond that throws
 * loudly rather than silently shipping without its resource — the v1 contract is "ship
 * what's declared", never "best-effort".
 */
export async function toResources(
  service: DiscoveredService,
  accountId: pulumi.Input<string>,
): Promise<ServiceResources> {
  const { name, dir, config } = service;

  await buildService(dir);
  const { content, contentSha256 } = await readBundle(dir, config);

  const databases: cloudflare.D1Database[] = [];
  const bindings: cloudflare.types.input.WorkersScriptBinding[] = [];

  for (const key of Object.keys(config)) {
    if (NON_BINDING_KEYS.has(key)) continue;

    switch (key) {
      case "d1_databases":
        for (const entry of config.d1_databases ?? []) {
          const db = new cloudflare.D1Database(`${name}-${entry.binding}`, {
            accountId,
            name: entry.database_name,
          });
          databases.push(db);
          bindings.push({ name: entry.binding, type: "d1", databaseId: db.id });
        }
        break;
      case "vars":
        for (const [varName, value] of Object.entries(config.vars ?? {})) {
          bindings.push({ name: varName, type: "plain_text", text: String(value) });
        }
        break;
      default:
        throw new Error(`infra doesn't support '${key}' yet`);
    }
  }

  const script = new cloudflare.WorkersScript(name, {
    accountId,
    scriptName: name,
    content,
    contentSha256,
    mainModule: "index.js",
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    bindings,
  });

  const subdomain = new cloudflare.WorkersScriptSubdomain(`${name}-subdomain`, {
    accountId,
    scriptName: script.scriptName,
    enabled: true,
  });

  return { script, databases, subdomain };
}

// Run the service's own build (its package.json "build" script — `vite build` via
// @cloudflare/vite-plugin for every shipped capability today) so `infra` always deploys
// freshly built output, never a stale dist/.
async function buildService(dir: string): Promise<void> {
  await execFileAsync("pnpm", ["run", "build"], { cwd: dir });
}

// @cloudflare/vite-plugin writes its deploy-ready output to dist/<worker-name>/,
// including a generated wrangler.json manifest whose "main" points at the built entry
// module — read that rather than guessing the bundle's filename. If the bridged
// provider ever can't take this shape directly, shell out to `wrangler deploy --config
// dist/<name>/wrangler.json` instead (the ADR 0021 escape hatch) and keep this
// function's contract (content + contentSha256) as the seam.
// Known v1 limitation: this reads only `manifest.main`, i.e. a single entry file. A
// code-split build (dynamic `import()`, multiple output chunks) would upload just the
// entry chunk and silently drop the rest — see the plan's open question on multi-file
// bundles. Every shipped capability today builds to a single-file Worker via
// @cloudflare/vite-plugin, so this holds for v1; revisit if/when a capability's build
// starts code-splitting.
async function readBundle(
  dir: string,
  config: WranglerConfig,
): Promise<{ content: string; contentSha256: string }> {
  const outDir = join(dir, "dist", config.name ?? "");
  const manifestPath = join(outDir, "wrangler.json");
  const manifestSource = await readFile(manifestPath, "utf8").catch(() => null);
  if (manifestSource === null) {
    throw new Error(
      `infra: no build output at ${manifestPath} — run the service's build first, or see ` +
        `the saasaloy-infra skill if @cloudflare/vite-plugin's output shape has changed.`,
    );
  }

  const manifest = JSON.parse(manifestSource) as { main?: string };
  if (!manifest.main) {
    throw new Error(`infra: ${manifestPath} has no "main" entry — can't locate the built Worker.`);
  }

  const content = await readFile(join(outDir, manifest.main), "utf8");
  const contentSha256 = createHash("sha256").update(content).digest("hex");
  return { content, contentSha256 };
}
