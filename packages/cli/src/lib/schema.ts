import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AjvDefault from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { pathExists } from "./fs-utils.js";

// ajv is CJS (`module.exports = Ajv2020`); under NodeNext the default import is typed
// as the module namespace, so re-point it to the class it actually is at runtime.
const Ajv2020 = AjvDefault as unknown as typeof AjvDefault.default;

// $schema-validated forcing functions for the three Saasaloy descriptors: the
// consumer manifest (saasaloy.json), the managed-file manifest (.saasaloy/manifest.json),
// and the module descriptor (registry-item.json). Authored descriptors validate
// against the JSON Schema documents in ../schemas so a typo fails fast with a clear
// error rather than surfacing as a mysterious applier crash later (build spec §3.2/§3.3).

export type SchemaName = "saasaloy" | "manifest" | "registry-item" | "saasaloy-lock";

const SCHEMA_FILES: Record<SchemaName, string> = {
  saasaloy: "saasaloy.schema.json",
  manifest: "manifest.schema.json",
  "registry-item": "registry-item.schema.json",
  "saasaloy-lock": "saasaloy-lock.schema.json",
};

// Schemas ship beside dist/ (see package.json "files"). At runtime import.meta.url is
// <pkg>/dist/index.js so ../schemas resolves to <pkg>/schemas; under vitest it's
// <pkg>/src/lib/schema.ts, so the schemas sit one level further up. Try both and cache.
const SCHEMA_DIR_CANDIDATES = ["../schemas", "../../schemas"];
let schemaDirPromise: Promise<string> | undefined;

async function schemaDir(): Promise<string> {
  if (!schemaDirPromise) {
    schemaDirPromise = (async () => {
      for (const candidate of SCHEMA_DIR_CANDIDATES) {
        const dir = fileURLToPath(new URL(candidate, import.meta.url));
        if (await pathExists(join(dir, "registry-item.schema.json"))) return dir;
      }
      // Fall back to the packaged location for a sensible ENOENT message.
      return fileURLToPath(new URL("../schemas", import.meta.url));
    })();
  }
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
  if (cached) return cached;
  const schema = JSON.parse(
    await readFile(join(await schemaDir(), SCHEMA_FILES[name]), "utf8"),
  ) as object;
  const validate = ajv.compile(schema);
  validators.set(name, validate);
  return validate;
}

/** Validate `data` against a named schema, returning clear messages on failure. */
export async function validate(name: SchemaName, data: unknown): Promise<ValidationResult> {
  const fn = await getValidator(name);
  const valid = fn(data) === true;
  return { valid, errors: valid ? [] : (fn.errors ?? []).map(formatError) };
}

// Turn an Ajv error into a single readable line. The default `message` omits the
// offending key for `additionalProperties`/`required`, which is exactly what an
// author needs to spot a typo, so we splice it back in.
function formatError(err: ErrorObject): string {
  const where = err.instancePath || "(root)";
  switch (err.keyword) {
    case "additionalProperties":
      return `${where}: unexpected property "${String(err.params.additionalProperty)}"`;
    case "required":
      return `${where}: missing required property "${String(err.params.missingProperty)}"`;
    case "enum": {
      const allowed = (err.params.allowedValues as unknown[]).join(", ");
      return `${where}: ${err.message ?? "is invalid"} (${allowed})`;
    }
    default:
      return `${where}: ${err.message ?? "is invalid"}`;
  }
}

// --- Typed views + convenience validators the applier (issue #6) builds on. ---

export interface SaasaloyConfig {
  aliases: Record<string, string>;
  installed: string[];
}

export interface RegistryFile {
  path: string;
  target: string;
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

export interface RegistryItem {
  name: string;
  type: "saasaloy:capability" | "saasaloy:feature";
  dependsOn?: string[];
  /** npm deps merged into the consumer's `dependencies`. Exact-pinned `name@version` (bare/range rejected by the schema). */
  dependencies?: string[];
  /** npm deps merged into the consumer's `devDependencies` (`@types/*`, build tooling). Same exact-pin form; a name in both buckets lands in `dependencies` only. */
  devDependencies?: string[];
  files?: RegistryFile[];
  envVars?: Record<string, string>;
  patches?: Record<string, unknown>;
  scaffolds?: RegistryScaffold[];
  agent?: RegistryAgent;
}

export function validateSaasaloyConfig(data: unknown): Promise<ValidationResult> {
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
