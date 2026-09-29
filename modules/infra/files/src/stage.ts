import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import ignore from "ignore";
import type { WranglerAssets } from "./discover.js";

// Files wrangler always leaves out of an assets upload, anchored at the assets root. A
// nested `docs/_headers` is an ordinary asset; only the root ones are config.
const ALWAYS_IGNORED = ["/.assetsignore", "/_headers", "/_redirects"];

export interface StagedAssetsConfig {
  headers?: string;
  redirects?: string;
  notFoundHandling?: string;
  htmlHandling?: string;
}

export interface StagedAssets {
  /** The staged copy to hand the provider as `assets.directory`. */
  directory: string;
  /** The provider's `assets.config`, holding only the keys this service sets. */
  config: StagedAssetsConfig;
}

/**
 * Copy a service's assets directory into `stageDir`, leaving out what wrangler would
 * leave out, and map its asset options onto the provider's `assets.config`.
 *
 * The staging copy exists because the Cloudflare provider uploads every file in
 * `assets.directory`, dotfiles included, and reads no `.assetsignore`. Pointed straight
 * at an Astro build it would publish `/.dev.vars` and `/wrangler.json`. So this mirrors
 * wrangler's rules instead: `.assetsignore` read from the assets root only, matched with
 * the same `ignore` package against paths relative to that root, plus the three root
 * files above. The service's own `dist/` is only read, never changed.
 *
 * `stageDir` is removed and copied again on every call, so a file the last build wrote
 * and this one did not never reaches Cloudflare.
 */
export async function stageAssets(
  serviceDir: string,
  assets: WranglerAssets,
  stageDir: string
): Promise<StagedAssets> {
  const sourceDir = resolve(serviceDir, assets.directory ?? ".");
  const sourceStat = await stat(sourceDir).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(
      `infra: no assets directory at ${sourceDir} — check "assets.directory" in ${join(serviceDir, "wrangler.jsonc")} and the service's build.`
    );
  }

  const assetsIgnore = await readOptional(join(sourceDir, ".assetsignore"));
  const matcher = ignore().add([
    ...(assetsIgnore?.split("\n") ?? []),
    ...ALWAYS_IGNORED,
  ]);

  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const entries = await readdir(sourceDir, { recursive: true });
  for (const entry of entries) {
    // `ignore` wants POSIX separators, whatever the platform wrote.
    const relativePath = entry.split(sep).join("/");
    if (matcher.ignores(relativePath)) {
      continue;
    }
    const from = join(sourceDir, entry);
    if (!(await stat(from)).isFile()) {
      continue;
    }
    const to = join(stageDir, entry);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }

  const config: StagedAssetsConfig = {};
  const headers = await readOptional(join(sourceDir, "_headers"));
  if (headers !== null) {
    config.headers = headers;
  }
  const redirects = await readOptional(join(sourceDir, "_redirects"));
  if (redirects !== null) {
    config.redirects = redirects;
  }
  if (assets.not_found_handling) {
    config.notFoundHandling = assets.not_found_handling;
  }
  if (assets.html_handling) {
    config.htmlHandling = assets.html_handling;
  }

  return { directory: stageDir, config };
}

function readOptional(path: string): Promise<string | null> {
  return readFile(path, "utf-8").catch(() => null);
}
