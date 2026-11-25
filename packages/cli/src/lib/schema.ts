import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AjvDefault from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { pathExists } from "./fs-utils.js";
import type { Patch } from "./patch/index.js";
import type { TestingMode } from "./testing.js";

// ajv is CJS (`module.exports = Ajv2020`); under NodeNext the default import is typed
// as the module namespace, so re-point it to the class it actually is at runtime.
const Ajv2020 = AjvDefault as unknown as typeof AjvDefault.default;

// $schema-validated forcing functions for the three Saasaloy descriptors: the
// consumer manifest (saasaloy.json), the managed-file manifest (.saasaloy/manifest.json),
// and the module descriptor (registry-item.json). Authored descriptors validate
// against the JSON Schema documents in ../schemas so a typo fails fast with a clear
// error rather than surfacing as a mysterious applier crash later (build spec §3.2/§3.3).

export type SchemaName =
  | "saasaloy"
  | "manifest"
  | "manifest-v2"
  | "registry-item"
  | "saasaloy-lock"
  | "update-note";

const SCHEMA_FILES: Record<SchemaName, string> = {
  manifest: "manifest.schema.json",
  "manifest-v2": "manifest-v2.schema.json",
  "registry-item": "registry-item.schema.json",
  saasaloy: "saasaloy.schema.json",
  "saasaloy-lock": "saasaloy-lock.schema.json",
  "update-note": "update-note.schema.json",
};

// Schemas ship beside dist/ (see package.json "files"). At runtime import.meta.url is
// <pkg>/dist/index.js so ../schemas resolves to <pkg>/schemas; under vitest it's
// <pkg>/src/lib/schema.ts, so the schemas sit one level further up. Try both and cache.
const SCHEMA_DIR_CANDIDATES = ["../schemas", "../../schemas"];
let schemaDirPromise: Promise<string> | undefined;

async function schemaDir(): Promise<string> {
  schemaDirPromise ??= (async () => {
    for (const candidate of SCHEMA_DIR_CANDIDATES) {
      const dir = fileURLToPath(new URL(candidate, import.meta.url));
      if (await pathExists(join(dir, "registry-item.schema.json"))) {
        return dir;
      }
    }
    // Fall back to the packaged location for a sensible ENOENT message.
    return fileURLToPath(new URL("../schemas", import.meta.url));
  })();
  return schemaDirPromise;
}

export interface ValidationResult {
  valid: boolean;
  /** Human-readable, one-per-line messages; empty when valid. */
  errors: string[];
}

// One Ajv instance, validators compiled lazily and cached — schemas are read off
// disk on first use so the CLI pays nothing for schemas it never touches.
const ajv = new Ajv2020({ allErrors: true });
const validators = new Map<SchemaName, ValidateFunction>();

async function getValidator(name: SchemaName): Promise<ValidateFunction> {
  const cached = validators.get(name);
  if (cached) {
    return cached;
  }
  const schema = JSON.parse(
    await readFile(join(await schemaDir(), SCHEMA_FILES[name]), "utf-8")
  ) as object;
  const validator = ajv.compile(schema);
  validators.set(name, validator);
  return validator;
}

/** Validate `data` against a named schema, returning clear messages on failure. */
export async function validate(
  name: SchemaName,
  data: unknown
): Promise<ValidationResult> {
  const fn = await getValidator(name);
  const valid = fn(data);
  return { errors: valid ? [] : (fn.errors ?? []).map(formatError), valid };
}

// Turn an Ajv error into a single readable line. The default `message` omits the
// offending key for `additionalProperties`/`required`, which is exactly what an
// author needs to spot a typo, so we splice it back in.
function formatError(err: ErrorObject): string {
  const where = err.instancePath || "(root)";
  switch (err.keyword) {
    case "additionalProperties": {
      return `${where}: unexpected property "${String(err.params.additionalProperty)}"`;
    }
    case "required": {
      return `${where}: missing required property "${String(err.params.missingProperty)}"`;
    }
    case "enum": {
      const allowed = (err.params.allowedValues as unknown[]).join(", ");
      return `${where}: ${err.message ?? "is invalid"} (${allowed})`;
    }
    default: {
      return `${where}: ${err.message ?? "is invalid"}`;
    }
  }
}

// --- Typed views + convenience validators the applier (issue #6) builds on. ---

export interface SaasaloyConfig {
  aliases: Record<string, string>;
  /**
   * The project's own name, written once by `saasaloy init` and never rewritten. It is the
   * `{{PROJECT_NAME}}` every base file was rendered with, so `update` re-renders the
   * template with the same value instead of guessing from the directory — a git worktree,
   * a renamed folder or a CI checkout path used to rewrite `package.json` `name`,
   * `wrangler.jsonc` `name` and `siteName` to the folder's name. Optional so a project
   * scaffolded before the field existed still validates; `resolveProjectName` falls back.
   */
  name?: string;
  /**
   * The base app `saasaloy init` scaffolded (`web`). It is not a module: it has no
   * descriptor and is never in `installed`. Its files record under the reserved manifest
   * module name `base`, and the lock's `base` object carries its provenance (#120). Until #98
   * the template listed it in `installed[]` and every engine carried an excuse for the
   * one name in that list it could say nothing about. Optional so a project scaffolded
   * before the field existed still validates; `loadConfig` migrates it.
   */
  base?: string;
  /**
   * The project's testing mode (#242). Optional so a project scaffolded before the field
   * existed still validates; `readTestingMode` reads an absent key as `off`.
   */
  testing?: { mode: TestingMode };
  installed: string[];
}

/**
 * The condition on an optional descriptor entry (#242, ADR 0054). The keys combine with
 * AND: `testing` ships the entry only when the project's testing mode is not `off`, and
 * `installed` only when every named module is in the resolved install set.
 */
export interface When {
  testing?: true;
  installed?: string[];
}

export interface RegistryFile {
  path: string;
  target: string;
  /** Ship this entry only while the condition holds; see {@link When} (#242). */
  when?: When;
  /**
   * Why this file ships with no test beside it (#242). Nothing reads it yet: a later
   * descriptor guard (#243) is to print the reason rather than fail. Top-level `files[]`
   * only.
   */
  untested?: string;
  /**
   * A module seed file (#310, ADR 0060): `add` and backfill write it once and record it,
   * and from then on it is the project's. `update` never overwrites or merges it, and puts
   * it back only when it is missing. `remove` deletes it while its hash still matches the
   * record and keeps it, with a warning, once the project changed it. A managed file
   * imports its extension point from one, so the project edits the seed and the managed
   * file stays clean. `RegistryScaffold.files` is this same type.
   */
  seed?: boolean;
}

// A new workspace a capability births. Its `files[].target`s are workspace-root-relative
// (no `@alias` — the alias root doesn't exist until this scaffold lands), and it declares
// the aliases the applier registers into saasaloy.json (ADR 0013).
export interface RegistryScaffold {
  /** New workspace directory, project-relative POSIX (e.g. `apps/api`). */
  workspace: string;
  /** Aliases this scaffold registers into saasaloy.json (e.g. `{ "@api": "apps/api/src" }`). */
  aliases?: Record<string, string>;
  /** Files copied into the workspace; each `target` is relative to `workspace`. */
  files: RegistryFile[];
}

export interface RegistryAgent {
  skills?: string[];
}

// A structural config patch as authored in registry-item.json: an engine `Patch`
// (kind + payload) plus the project-relative `file` it targets. Serialized as a flat
// array so one module can patch several files, each op self-describing (ADR 0019).
// `when` gates the op like a file entry (#242). The op is recorded "as authored", `when`
// included, so the structural match `remove` untracks with stays stable (A7).
export type RegistryPatch = { file: string; when?: When } & Patch;

/** The four layouts a generated table takes (plan 0116, "Formats"). */
export const TABLE_SHAPES = ["calls", "objects", "routes", "nav"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** A named import an entry needs in the generated file: `import { name } from "from"`. */
export interface TableImport {
  name: string;
  from: string;
}

/**
 * A registration table the module owns (plan 0116, Phase 7). The render writes `file` in
 * full on every run, class `generated`, holding one export for each table of that file.
 * The export's name is the camelCase of `id`: `email.providers` is `emailProviders`. The
 * file that held the table before imports that export and spreads it, after the entries
 * the owning module ships inline and before the owner's own.
 */
export interface RegistryTable {
  /** Unique across the payload: `<owner>.<table>`, such as `email.providers`. */
  id: string;
  /** Project path of the generated file, `@alias` allowed. Ends in `.generated.ts`. */
  file: string;
  /**
   * `calls` exports `[a(), b()]`; `objects` exports `[{ … }]`; `routes` exports a function
   * that chains `.route(path, router)` onto the app it takes; `nav` exports `[{ area,
   * group, …row, icon }] as const`.
   */
  shape: TableShape;
  /** The element type of an `objects` table, imported as a type: `T[]`. */
  type?: TableImport;
}

/**
 * One row a module adds to a table. The render writes each table sorted by `order`, then
 * by module name; the entries of one module keep their descriptor order.
 */
export interface RegistryEntry {
  /** The `id` of the table this row goes into. */
  table: string;
  /** `calls`: the factory, printed `call()`. `routes`: the router, `.route(path, call)`. */
  call?: string;
  /** `calls` and `routes`: the import of `call`. `nav`: the icon component. */
  import?: TableImport;
  /** `routes`: the mount path, such as `/waitlist`. */
  path?: string;
  /** `objects`: the JSON object. `nav`: the row without its icon (`to`, `label`, …). */
  entry?: Record<string, unknown>;
  /** `nav`: the `to` of the area the row goes into. */
  area?: string;
  /** `nav`: the label of the group; a missing group is added after the area's last one. */
  group?: string;
  /** Sort key, 1000 when absent. A lower order comes first. */
  order?: number;
  /** Write this row only while the condition holds; see {@link When}. */
  when?: When;
}

/** The `stage` enum in registry-item.schema.json, in product order (#223). */
export const MODULE_STAGES = [
  "validate",
  "mvp",
  "teams",
  "money",
  "scale",
] as const;
export type ModuleStage = (typeof MODULE_STAGES)[number];

/** The `needs` enum in registry-item.schema.json (#223). */
export const MODULE_NEEDS = [
  "cloudflare-paid",
  "stripe",
  "domain",
  "vendor-account",
] as const;
export type ModuleNeed = (typeof MODULE_NEEDS)[number];

/**
 * When a conditional key is required: the controlling key holds `is` in its comma list, or
 * does not hold `isNot`.
 */
export type EnvCondition =
  { key: string; is: string } | { key: string; isNot: string };

export interface RegistryItem {
  name: string;
  type: "saasaloy:capability" | "saasaloy:feature";
  /** One line on what the module gives a project. Optional in the schema; `doctor` on a registry requires it. */
  description?: string;
  /** The product stage that usually earns this module. */
  stage?: ModuleStage;
  /** What the module needs outside the repo before it works in production. Empty means nothing. */
  needs?: ModuleNeed[];
  /**
   * Tool versions this descriptor needs. `saasaloy` is a semver range the running CLI has
   * to satisfy; a CLI outside it refuses the whole run before planning a single write,
   * naming this module even when it arrived as a transitive `dependsOn` (#50).
   */
  requires?: { saasaloy?: string };
  dependsOn?: string[];
  /** Modules this one refuses to sit beside; `add` refuses rather than installing both. Recorded in the lockfile so the check works in either install order. */
  conflictsWith?: string[];
  /** Modules exactly one of which has to be present — a capability naming its mutually exclusive drivers. `add` refuses when none is installed or in the resolved graph, and offers the list as a prompt on a terminal. */
  requiresOneOf?: string[];
  /** npm deps merged into the consumer's `dependencies`. Exact-pinned `name@version` (bare/range rejected by the schema). */
  dependencies?: string[];
  /** npm deps merged into the consumer's `devDependencies` (`@types/*`, build tooling). Same exact-pin form; a name in both buckets lands in `dependencies` only. */
  devDependencies?: string[];
  files?: RegistryFile[];
  envVars?: Record<string, string>;
  /** Which services read each `envVars` key: a `default` list plus per-key overrides. Omitted, the `PUBLIC_` prefix rule decides and `add` warns. */
  envServices?: Record<string, string[]>;
  /** Keys from `envVars` that may stay empty; each gets a `# Blank on purpose` line in the key list. */
  envOptional?: string[];
  /**
   * Keys from `envVars` that may stay empty unless another key holds a named value: key →
   * `{ key, is }` or `{ key, isNot }`. Each gets a `# @required-when` line in the key list.
   */
  envRequiredWhen?: Record<string, EnvCondition>;
  /** Local-dev values for a subset of `envVars`, pre-filled into `packages/env/.env.example`. Never a secret: a loopback URL or a fixed port, the same on every machine. */
  devVars?: Record<string, string>;
  /** Warnings persisted at add time and printed before this module is removed. */
  removeWarnings?: string[];
  patches?: RegistryPatch[];
  /** Registration tables this module owns; the render writes each one as a generated file. */
  tables?: RegistryTable[];
  /** Rows this module adds to tables, its own or another module's. */
  entries?: RegistryEntry[];
  scaffolds?: RegistryScaffold[];
  agent?: RegistryAgent;
  /**
   * Adding this module turns testing on: a project whose mode is `off` moves to
   * `tests-after` once the apply succeeds, and its gated files are backfilled (#242).
   */
  enablesTesting?: true;
}

export function validateSaasaloyConfig(
  data: unknown
): Promise<ValidationResult> {
  return validate("saasaloy", data);
}

export function validateManifest(data: unknown): Promise<ValidationResult> {
  return validate("manifest", data);
}

/** Validate a version 2 manifest, the render engine's format (plan 0116). */
export function validateManifestV2(data: unknown): Promise<ValidationResult> {
  return validate("manifest-v2", data);
}

export function validateRegistryItem(data: unknown): Promise<ValidationResult> {
  return validate("registry-item", data);
}

export function validateLock(data: unknown): Promise<ValidationResult> {
  return validate("saasaloy-lock", data);
}

/** Validate an update note's parsed frontmatter (#298). `lib/update-notes.ts` calls it. */
export function validateUpdateNote(data: unknown): Promise<ValidationResult> {
  return validate("update-note", data);
}
