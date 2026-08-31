import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RefusalError } from "./exit.js";
import { pathExists } from "./fs-utils.js";
import type { SaasaloyConfig } from "./schema.js";
import { validateSaasaloyConfig } from "./schema.js";

// `saasaloy.json` is the consumer manifest at a generated project's root: the alias
// map that resolves module file targets, plus the `installed` list that drives
// dependsOn resolution (build spec §3.2). This loads/saves it and turns an
// alias-prefixed target (`@api/routes/x.ts`) into a project-relative path.

export const CONFIG_FILE = "saasaloy.json";

// The raw parse keeps the optional `$schema` pointer so a round-trip save doesn't
// strip an author's editor-validation hint.
export type LoadedConfig = SaasaloyConfig & { $schema?: string };

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const file = join(root, CONFIG_FILE);
  if (!(await pathExists(file))) {
    throw new RefusalError(
      `No ${CONFIG_FILE} found in ${root}. Run \`saasaloy init\` first, or cd into a Saasaloy project.`
    );
  }
  const parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
  const result = await validateSaasaloyConfig(parsed);
  if (!result.valid) {
    throw new RefusalError(
      `${CONFIG_FILE} is invalid:\n  ${result.errors.join("\n  ")}`
    );
  }
  return migrateBase(parsed as LoadedConfig);
}

/**
 * The base app moved out of `installed[]` and into its own `base` field (#98). A project
 * scaffolded before that still lists `web` as if the tool had applied it, which is what
 * forced every engine to carry a "except the template's own `web`" branch. Lift it here,
 * once, on load: from this point on `installed[]` holds only modules `saasaloy add` put
 * there, and the next `saveConfig` persists the corrected shape.
 *
 * Only `web` is lifted. It is the one name the template ever wrote, and guessing at any
 * other would silently unmanage a real module.
 */
const LEGACY_BASE = "web";

export function migrateBase(config: LoadedConfig): LoadedConfig {
  if (config.base !== undefined || !config.installed.includes(LEGACY_BASE)) {
    return config;
  }
  return {
    ...config,
    base: LEGACY_BASE,
    installed: config.installed.filter((name) => name !== LEGACY_BASE),
  };
}

export async function saveConfig(
  root: string,
  config: LoadedConfig
): Promise<void> {
  const file = join(root, CONFIG_FILE);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

// Resolve `@api/routes/x.ts` against the alias map to a project-relative POSIX path
// (e.g. `apps/api/src/routes/x.ts`). POSIX separators keep manifest keys stable
// across OSes; callers split on "/" when touching the filesystem.
export function resolveTarget(
  aliases: Record<string, string>,
  target: string
): string {
  const slash = target.indexOf("/");
  if (slash === -1) {
    throw new RefusalError(
      `Malformed target "${target}" — expected "@alias/rest".`
    );
  }
  const alias = target.slice(0, slash);
  const rest = target.slice(slash + 1);
  const base = aliases[alias];
  if (base === undefined) {
    const known = Object.keys(aliases).join(", ") || "(none)";
    throw new RefusalError(
      `Unknown alias "${alias}" in target "${target}". Known aliases: ${known}.`
    );
  }
  // `base` is already POSIX + no leading slash (enforced by the schema); join by hand
  // to avoid the platform separator that node:path would introduce on Windows.
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}/${rest}`;
}
