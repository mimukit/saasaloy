import { readFile } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { joinModulePath, pathExists, readDirNames } from "./fs-utils.js";
import { loadConfig } from "./saasaloy-config.js";
import { baseTemplateDir } from "./scaffold.js";
import { validateRegistryItem } from "./schema.js";

// The checks behind `saasaloy doctor`. Split from the command so the rules are testable
// without a terminal, and so a future `doctor owner/repo/name` (the consumer path, a
// follow-up) can reuse them against a downloaded folder.
//
// Everything here is local: a module folder, its siblings in the same registry, and the
// alias map the base template establishes. Nothing is fetched, so an author can run it
// before publishing rather than finding out on a stranger's machine.

export interface Finding {
  /** The module folder the finding belongs to. */
  module: string;
  /** Where inside the descriptor, in the shape ajv prints (`/files/0/target`). */
  where: string;
  message: string;
}

export interface ModuleReport {
  module: string;
  /** Absolute path of the module folder. */
  dir: string;
  findings: Finding[];
}

/** The aliases a descriptor's `files[].target` may name. */
export interface AliasSources {
  /** `@web`, `@ui` — established by `saasaloy init`, before any module applies. */
  base: Record<string, string>;
  /** Every alias a scaffold in this registry registers, e.g. `@api` from the api module. */
  fromScaffolds: Record<string, string>;
}

// Every skill folder a module ships is prefixed, so two registries' skills can sit in one
// `.claude/skills/` without colliding (ADR 0014).
const SKILL_PREFIX = "saasaloy-";

// `dependencies` and `devDependencies` are exact-pinned `name@version` (ADR 0017). The
// schema enforces the same shape; this repeats it so the report says what is wrong with
// the entry rather than only that a pattern did not match.
const PINNED_DEP = /^(@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;

function finding(module: string, where: string, message: string): Finding {
  return { message, module, where };
}

// The descriptor is parsed before the schema has vouched for it — that is the point of
// doctor — so every field read below goes through one of these instead of a cast the
// JSON can violate. A wrong-shaped field reads as absent here and the schema pass names
// it; iterating `"scaffolds": {}` directly would throw and swallow the whole report.
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Names of the module folders under `dir` — a folder counts when it carries a descriptor,
 * the same rule `LocalRegistrySource.listModules` uses.
 */
export async function registryModuleNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for (const name of await readDirNames(dir)) {
    if (await pathExists(join(dir, name, "registry-item.json"))) {
      names.push(name);
    }
  }
  return names.toSorted();
}

/**
 * The alias map a descriptor in `registryDir` may target. The base template's own
 * `saasaloy.json` supplies the aliases every project starts with; each capability's
 * `scaffolds[].aliases` supplies the ones a project gains by installing it.
 */
export async function collectAliases(
  registryDir: string,
  names: string[]
): Promise<AliasSources> {
  const templateDir = await baseTemplateDir();
  let base: Record<string, string> = {};
  if (await pathExists(join(templateDir, "saasaloy.json"))) {
    base = (await loadConfig(templateDir)).aliases;
  }

  const fromScaffolds: Record<string, string> = {};
  for (const name of names) {
    const item = asRecord(await readDescriptor(join(registryDir, name)));
    for (const scaffold of asArray(item.scaffolds)) {
      const aliases = asRecord(asRecord(scaffold).aliases);
      for (const [alias, prefix] of Object.entries(aliases)) {
        if (typeof prefix === "string") {
          fromScaffolds[alias] = prefix;
        }
      }
    }
  }
  return { base, fromScaffolds };
}

/** Parse a module folder's descriptor, or `undefined` when it is missing or unreadable. */
async function readDescriptor(dir: string): Promise<unknown> {
  const file = join(dir, "registry-item.json");
  if (!(await pathExists(file))) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(file, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
}

export interface CheckModuleInput {
  /** Absolute path of the module folder. */
  dir: string;
  /** Every module name the surrounding registry offers, for `dependsOn` resolution. */
  siblings: string[];
  aliases: AliasSources;
}

/**
 * Every violation one module folder carries. Schema errors and structural errors are
 * reported together rather than the schema pass short-circuiting: an author fixing a
 * descriptor wants the whole list, not the first line of it.
 */
export async function checkModule(
  input: CheckModuleInput
): Promise<ModuleReport> {
  const { aliases, dir, siblings } = input;
  const module = basename(dir);
  const findings: Finding[] = [];
  const report = (): ModuleReport => ({ dir, findings, module });

  const file = join(dir, "registry-item.json");
  if (!(await pathExists(file))) {
    findings.push(
      finding(module, "(root)", `no registry-item.json in ${module}/`)
    );
    return report();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
  } catch (error) {
    findings.push(
      finding(
        module,
        "(root)",
        `registry-item.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return report();
  }

  const schema = await validateRegistryItem(parsed);
  const schemaFindings = schema.errors.map((error) => {
    const [where, ...rest] = error.split(": ");
    return finding(module, where ?? "(root)", rest.join(": "));
  });

  // The structural checks below read the parsed object even when the schema rejected it.
  // A descriptor usually fails on one property, and reporting only that hides the
  // missing file or the unknown alias the author would fix in the same pass.
  const item = asRecord(parsed);

  if (typeof item.name === "string" && item.name !== module) {
    findings.push(
      finding(
        module,
        "/name",
        `declares name "${item.name}" — the folder and the descriptor name must match`
      )
    );
  }

  const known = { ...aliases.base, ...aliases.fromScaffolds };
  const knownList = Object.keys(known).toSorted().join(", ") || "(none)";
  for (const [index, entry] of asArray(item.files).entries()) {
    await checkSourcePath(findings, module, dir, `/files/${index}/path`, entry);
    const target = asRecord(entry).target;
    const alias = typeof target === "string" ? target.split("/")[0] : undefined;
    if (alias && !(alias in known)) {
      findings.push(
        finding(
          module,
          `/files/${index}/target`,
          `unknown alias "${alias}" in "${String(target)}" — known aliases: ${knownList}`
        )
      );
    }
  }

  for (const [index, scaffold] of asArray(item.scaffolds).entries()) {
    for (const [fileIndex, entry] of asArray(
      asRecord(scaffold).files
    ).entries()) {
      await checkSourcePath(
        findings,
        module,
        dir,
        `/scaffolds/${index}/files/${fileIndex}/path`,
        entry
      );
    }
  }

  const siblingSet = new Set(siblings);
  for (const [field, names] of [
    ["dependsOn", item.dependsOn],
    ["requiresOneOf", item.requiresOneOf],
    ["conflictsWith", item.conflictsWith],
  ] as const) {
    for (const [index, name] of asArray(names).entries()) {
      if (typeof name === "string" && !siblingSet.has(name)) {
        findings.push(
          finding(
            module,
            `/${field}/${index}`,
            `names "${name}", which this registry does not offer`
          )
        );
      }
    }
  }

  for (const [field, deps] of [
    ["dependencies", item.dependencies],
    ["devDependencies", item.devDependencies],
  ] as const) {
    for (const [index, dep] of asArray(deps).entries()) {
      if (typeof dep === "string" && !PINNED_DEP.test(dep)) {
        findings.push(
          finding(
            module,
            `/${field}/${index}`,
            `"${dep}" is not exact-pinned — write it as name@1.2.3 (ADR 0017; \`pnpm deps:update\` fills the version)`
          )
        );
      }
    }
  }

  // Every `devVars` key is a local value for an env var the module declares. A key with
  // no `envVars` entry is written to nothing, which the schema documents and cannot check.
  for (const key of Object.keys(asRecord(item.devVars))) {
    if (!(key in asRecord(item.envVars))) {
      findings.push(
        finding(
          module,
          `/devVars/${key}`,
          `has no matching entry in envVars, so nothing describes it`
        )
      );
    }
  }

  for (const [index, skill] of asArray(asRecord(item.agent).skills).entries()) {
    if (typeof skill !== "string") {
      continue;
    }
    const folder = posix.basename(skill);
    if (!folder.startsWith(SKILL_PREFIX)) {
      findings.push(
        finding(
          module,
          `/agent/skills/${index}`,
          `skill folder "${folder}" must start with "${SKILL_PREFIX}" (ADR 0014)`
        )
      );
    }
    const missing = await missingModulePath(dir, skill);
    if (missing) {
      findings.push(
        finding(
          module,
          `/agent/skills/${index}`,
          missing === "escape"
            ? `"${skill}" escapes the module folder`
            : `no such folder: ${skill}`
        )
      );
    }
  }

  // Schema errors come first, minus any the checks above already explained better at the
  // same path. An unpinned dependency fails a schema pattern *and* a rule here; printing
  // both leaves the author reading a raw regex next to the sentence that answers it.
  const explained = new Set(findings.map((found) => found.where));
  findings.unshift(
    ...schemaFindings.filter((found) => !explained.has(found.where))
  );

  return report();
}

async function checkSourcePath(
  findings: Finding[],
  module: string,
  dir: string,
  where: string,
  entry: unknown
): Promise<void> {
  const path = asRecord(entry).path;
  if (typeof path !== "string" || path === "") {
    return;
  }
  const missing = await missingModulePath(dir, path);
  if (missing) {
    findings.push(
      finding(
        module,
        where,
        missing === "escape"
          ? `"${path}" escapes the module folder — the applier refuses this descriptor`
          : `no such file: ${path}`
      )
    );
  }
}

/**
 * Whether a descriptor-authored path is absent under the module folder, and why. The
 * applier resolves the same paths through `joinModulePath`, so a `../` that slips past
 * doctor here would be reported present and then refused on a stranger's machine.
 */
async function missingModulePath(
  dir: string,
  relPosix: string
): Promise<false | "absent" | "escape"> {
  let abs: string;
  try {
    abs = joinModulePath(dir, relPosix);
  } catch {
    return "escape";
  }
  return (await pathExists(abs)) ? false : "absent";
}

export interface DoctorTarget {
  /** The registry directory the modules sit in. */
  registryDir: string;
  /** Module folder names to check — one, or every module the registry offers. */
  names: string[];
}

/**
 * Read `path` as either one module folder or a registry of them. A folder carrying a
 * `registry-item.json` is the module; anything else is a directory of module folders.
 */
export async function resolveDoctorTarget(path: string): Promise<DoctorTarget> {
  const dir = resolve(path);
  if (await pathExists(join(dir, "registry-item.json"))) {
    return { names: [basename(dir)], registryDir: dirname(dir) };
  }
  return { names: await registryModuleNames(dir), registryDir: dir };
}

/** Check every module named by `target`, in name order. */
export async function checkTarget(
  target: DoctorTarget
): Promise<ModuleReport[]> {
  const siblings = await registryModuleNames(target.registryDir);
  const aliases = await collectAliases(target.registryDir, siblings);
  const reports: ModuleReport[] = [];
  for (const name of target.names) {
    reports.push(
      await checkModule({
        aliases,
        dir: join(target.registryDir, name),
        siblings,
      })
    );
  }
  return reports;
}
