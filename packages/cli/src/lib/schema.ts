import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AjvDefault from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { pathExists } from "./fs-utils.js";
import type { Patch } from "./patch/index.js";

// ajv is CJS (`module.exports = Ajv2020`); under NodeNext the default import is typed
// as the module namespace, so re-point it to the class it actually is at runtime.
const Ajv2020 = AjvDefault as unknown as typeof AjvDefault.default;

// $schema-validated forcing functions for the three Saasaloy descriptors: the
// consumer manifest (saasaloy.json), the managed-file manifest (.saasaloy/manifest.json),
// and the module descriptor (registry-item.json). Authored descriptors validate
// against the JSON Schema documents in ../schemas so a typo fails fast with a clear
// error rather than surfacing as a mysterious applier crash later (build spec §3.2/§3.3).

export type SchemaName =
  "saasaloy" | "manifest" | "registry-item" | "saasaloy-lock";

const SCHEMA_FILES: Record<SchemaName, string> = {
  manifest: "manifest.schema.json",
  "registry-item": "registry-item.schema.json",
  saasaloy: "saasaloy.schema.json",
  "saasaloy-lock": "saasaloy-lock.schema.json",
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
   * The base app `saasaloy init` scaffolded (`web`). It is not a module: the tool never
   * applied it, so it has no descriptor, no manifest entry and no lock entry. Until #98
   * the template listed it in `installed[]` and every engine carried an excuse for the
   * one name in that list it could say nothing about. Optional so a project scaffolded
   * before the field existed still validates; `loadConfig` migrates it.
   */
  base?: string;
  installed: string[];
}

export interface RegistryFile {
  path: string;
  target: string;
  /**
   * Install this file only when the named module is in the resolved install set (#99).
   * Two entries may share one `target` under disjoint conditions, which is how a module
   * ships a sqlite and a pg variant of one dialect-bound file. `RegistryScaffold.files`
   * is this same type, so the keyword covers a scaffold's workspace files too.
   */
  onlyWith?: string;
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
export type RegistryPatch = { file: string } & Patch;

export interface RegistryItem {
  name: string;
  type: "saasaloy:capability" | "saasaloy:feature";
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
  /** Local-dev values for a subset of `envVars`, pre-filled into `.dev.vars.example`. Never a secret: a loopback URL or a fixed port, the same on every machine. */
  devVars?: Record<string, string>;
  patches?: RegistryPatch[];
  scaffolds?: RegistryScaffold[];
  agent?: RegistryAgent;
}

export function validateSaasaloyConfig(
  data: unknown
): Promise<ValidationResult> {
  return validate("saasaloy", data);
}

export function validateManifest(data: unknown): Promise<ValidationResult> {
  return validate("manifest", data);
}

export function validateRegistryItem(data: unknown): Promise<ValidationResult> {
  return validate("registry-item", data);
}

export function validateLock(data: unknown): Promise<ValidationResult> {
  return validate("saasaloy-lock", data);
}
