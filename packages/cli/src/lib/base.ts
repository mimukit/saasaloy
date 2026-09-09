import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { hashContent, readIfPresent, resolveWithinRoot } from "./fs-utils.js";
import type { LockBase, Lockfile } from "./lock.js";
import { saveLock } from "./lock.js";
import type { ManagedEntry, Manifest } from "./manifest.js";
import { saveManifest } from "./manifest.js";
import {
  BASE_DECLARATION,
  baseTemplateDir,
  copyTemplate,
  renderedName,
  templateVars,
} from "./scaffold.js";
import type { WrittenFile } from "./scaffold.js";
import type { ModuleComparison, ModuleUpdateInput } from "./updater.js";

export { BASE_DECLARATION } from "./scaffold.js";

// The base template's provenance (#120, ADR 0032). `saasaloy init` copies the template
// bundled inside the CLI package, and until this file nothing recorded what it copied:
// no manifest entry, no lock entry, no version stamp (ADR 0022's "one-time gift"). So
// `outdated`, `update` and `doctor` could say nothing about the largest body of code the
// tool generates. The base now records like a module — one `managed` entry per rendered
// file under the reserved module name `base` — plus a lock record keyed by CLI version
// and template hash, because the base ships with the CLI rather than in a registry.
//
// Three rules keep the record honest:
//   - hashes are of *rendered* bytes: `{{PROJECT_NAME}}` is substituted at copy time, and
//     hashing the template source would mark every substituted file drifted forever;
//   - `templateHash` is over the template *as shipped*, so two CLI builds carrying an
//     identical template compare equal and a republished template is still detected;
//   - seed files (`_saasaloy-base.json`'s `seedFiles`) are recorded but never updated —
//     the owner is meant to rewrite them.

/** The reserved module name base files record under. Never in `saasaloy.json`'s `installed`. */
export const BASE_MODULE = "base";

/** `saasaloy.json`'s `base` value — the one base app the template ships. */
export const DEFAULT_BASE_NAME = "web";

/** The lock's record of the base — re-exported under the name the plan uses. */
export type BaseRecord = LockBase;

/** Why the base's merge plan is two-way, stamped on its section header. */
export const BASE_NO_MERGE_BASE =
  "the template ships with the CLI; the previous version isn't on disk";

/** The one intent line a drifted base file carries, for the agent reading the plan. */
export const BASE_INTENT =
  "the base template changed; keep local edits, take the upstream change";

export interface BaseDeclaration {
  /** Project-relative POSIX paths the owner is meant to rewrite; recorded, never updated. */
  seedFiles: string[];
}

/** One file the template ships, before and after the `_` → `.` rename. */
export interface TemplateFile {
  /** Template-relative POSIX source path — the manifest's `from`. */
  from: string;
  /** Project-relative POSIX path once rendered — the manifest key. */
  target: string;
  /** Absolute path of the source file inside the template. */
  abs: string;
}

/**
 * Read `_saasaloy-base.json` off a template. A template with none has no seed files. The
 * declaration ships inside this package, so a malformed one is a build error worth a
 * plain throw rather than a refusal aimed at the user.
 */
export async function readBaseDeclaration(
  templateDir: string
): Promise<BaseDeclaration> {
  const raw = await readIfPresent(join(templateDir, BASE_DECLARATION));
  if (raw === undefined) {
    return { seedFiles: [] };
  }
  const parsed = JSON.parse(raw) as { seedFiles?: unknown };
  const seedFiles = parsed.seedFiles;
  if (
    !Array.isArray(seedFiles) ||
    !seedFiles.every((entry) => typeof entry === "string" && entry !== "")
  ) {
    throw new Error(
      `${BASE_DECLARATION} must declare "seedFiles" as a list of project-relative paths.`
    );
  }
  return { seedFiles: seedFiles as string[] };
}

/** Every file the template ships, sorted by target, the declaration excluded. */
export async function listTemplateFiles(
  templateDir: string
): Promise<TemplateFile[]> {
  const out: TemplateFile[] = [];
  const walk = async (
    dir: string,
    fromPrefix: string,
    targetPrefix: string,
    isRoot: boolean
  ): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (isRoot && entry.name === BASE_DECLARATION) {
        continue;
      }
      const from = posix.join(fromPrefix, entry.name);
      const target = posix.join(targetPrefix, renderedName(entry.name));
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, from, target, false);
      } else if (entry.isFile()) {
        out.push({ from, target, abs });
      }
    }
  };
  await walk(templateDir, "", "", true);
  return out.toSorted((a, b) => (a.target < b.target ? -1 : 1));
}

// Computed on demand and cached per process: the template is about fifty files and the
// walk is milliseconds, and a runtime hash cannot drift from the files the way a
// build-time constant could.
const hashCache = new Map<string, Promise<string>>();

/**
 * sha256 over the sorted `(target, sha256 of source bytes)` pairs of the template as
 * shipped. Source bytes, not rendered: this identifies the template, and a project name
 * must not change it.
 */
export function templateHash(templateDir: string): Promise<string> {
  let cached = hashCache.get(templateDir);
  if (!cached) {
    cached = (async () => {
      const digest = createHash("sha256");
      for (const file of await listTemplateFiles(templateDir)) {
        digest.update(file.target);
        digest.update("\0");
        digest.update(hashContent(await readFile(file.abs, "utf-8")));
        digest.update("\n");
      }
      return digest.digest("hex");
    })();
    hashCache.set(templateDir, cached);
  }
  return cached;
}

/** The lock's `base` record for a template at `templateHash`, rendered by `cliVersion`. */
export function baseRecord(
  cliVersion: string,
  hash: string,
  name = DEFAULT_BASE_NAME
): BaseRecord {
  return { name, cliVersion, templateHash: hash };
}

/** The manifest entries the base owns, keyed by target. */
export function baseEntries(manifest: Manifest): Record<string, ManagedEntry> {
  const out: Record<string, ManagedEntry> = {};
  for (const [target, entry] of Object.entries(manifest.managed)) {
    if (entry.module === BASE_MODULE) {
      out[target] = entry;
    }
  }
  return out;
}

/** What `recordBaseFiles` needs of a file: the same three fields `copyTemplate` returns. */
export type BaseFileRecord = Pick<WrittenFile, "target" | "from" | "hash">;

/**
 * Replace the base's manifest entries with `files`. Entries other modules own are left
 * alone; a base entry `files` no longer names is dropped, so the record is always the
 * template that was last rendered or adopted.
 */
export function recordBaseFiles(
  manifest: Manifest,
  files: readonly BaseFileRecord[]
): void {
  for (const [target, entry] of Object.entries(manifest.managed)) {
    if (entry.module === BASE_MODULE) {
      delete manifest.managed[target];
    }
  }
  for (const file of files) {
    manifest.managed[file.target] = {
      module: BASE_MODULE,
      hash: file.hash,
      from: file.from,
    };
  }
}

/**
 * Whether the project carries a usable base record: the lock's `base` *and* at least one
 * manifest entry for it. A lock record with no manifest entries has nothing to classify
 * against, so it counts as untracked and `update` re-adopts.
 */
export function isBaseTracked(lock: Lockfile, manifest: Manifest): boolean {
  return (
    lock.base !== undefined && Object.keys(baseEntries(manifest)).length > 0
  );
}

/**
 * Base targets the manifest tracks that are not on disk — the files `update` classifies as
 * `restore`. `compareBase` needs this because `templateHash` only says whether the *template*
 * moved: a file deleted from disk (or recorded absent by `adoptBase`) leaves the hash equal,
 * so without this the base reads `current` and the restore never runs (#120).
 *
 * Seed files are excluded. They are recorded but never updated, so a missing one produces no
 * plan action and would leave the base permanently `outdated` with nothing to apply.
 */
export async function missingBaseTargets(
  root: string,
  manifest: Manifest,
  templateDir: string
): Promise<string[]> {
  const seed = new Set((await readBaseDeclaration(templateDir)).seedFiles);
  const missing: string[] = [];
  for (const target of Object.keys(baseEntries(manifest))) {
    if (seed.has(target)) {
      continue;
    }
    if ((await readIfPresent(resolveWithinRoot(root, target))) === undefined) {
      missing.push(target);
    }
  }
  return missing.toSorted((a, b) => (a < b ? -1 : 1));
}

/** The template rendered with a project's own vars, in a temp dir the caller removes. */
export interface RenderedTemplate {
  dir: string;
  files: WrittenFile[];
  cleanup: () => Promise<void>;
}

/**
 * Render the bundled template for `root` into a temp dir, source names kept, so each
 * file's `from` resolves inside the render and its `hash` is of the bytes `init` would
 * have written for this project.
 */
export async function renderTemplate(
  root: string,
  templateDir: string
): Promise<RenderedTemplate> {
  const dir = await mkdtemp(join(tmpdir(), "saasaloy-base-render-"));
  const files = await copyTemplate(
    templateDir,
    dir,
    templateVars(basename(root)),
    { keepNames: true }
  );
  return {
    dir,
    files,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export interface AdoptBaseArgs {
  root: string;
  /** The running CLI's version — the record says the base was adopted here. */
  cliVersion: string;
  /** Loaded state, mutated in place and saved unless `dryRun`. */
  manifest: Manifest;
  lock: Lockfile;
  /** Report only: neither state file is written. */
  dryRun?: boolean;
  /** Defaults to the bundled template; tests point it at a fixture. */
  templateDir?: string;
}

export interface AdoptBaseResult {
  /** Targets recorded at the hash they have on disk. */
  adopted: string[];
  /** Template files not on disk, recorded at their rendered hash so the next update restores them. */
  absent: string[];
  record: BaseRecord;
}

/**
 * Give an unrecorded project a base record at the running CLI (#120). Every file today's
 * template ships is recorded at the hash it has on disk — edits and all — so the next
 * `update` classifies against what is really there and never manufactures a wall of
 * conflicts on a customised project. A file the template no longer ships is not recorded;
 * a template file missing from disk is recorded at its rendered hash, which `update`
 * reads as "tracked but missing" and restores. Adoption records the present, not the
 * past: it skips at most one generation of base changes.
 */
export async function adoptBase(args: AdoptBaseArgs): Promise<AdoptBaseResult> {
  const { root, cliVersion, manifest, lock, dryRun = false } = args;
  const templateDir = args.templateDir ?? (await baseTemplateDir());
  const render = await renderTemplate(root, templateDir);
  try {
    const files: BaseFileRecord[] = [];
    const adopted: string[] = [];
    const absent: string[] = [];
    for (const file of render.files) {
      const mine = await readIfPresent(resolveWithinRoot(root, file.target));
      if (mine === undefined) {
        absent.push(file.target);
        files.push({ target: file.target, from: file.from, hash: file.hash });
      } else {
        adopted.push(file.target);
        files.push({
          target: file.target,
          from: file.from,
          hash: hashContent(mine),
        });
      }
    }
    const record = baseRecord(
      cliVersion,
      await templateHash(templateDir),
      lock.base?.name ?? DEFAULT_BASE_NAME
    );
    if (!dryRun) {
      recordBaseFiles(manifest, files);
      lock.base = record;
      await saveManifest(root, manifest);
      await saveLock(root, lock);
    }
    return { adopted, absent, record };
  } finally {
    await render.cleanup();
  }
}

export interface BaseUpdateArgs {
  root: string;
  manifest: Manifest;
  lock: Lockfile;
  /** The template the running CLI ships — `baseTemplateDir()`, or a fixture. */
  templateDir: string;
  /** The running CLI's version, written into the record a clean run moves to. */
  cliVersion: string;
  /** The `outdated` row from `compareBase`, carried into the plan for the summary. */
  comparison: ModuleComparison;
}

export interface BaseUpdateHandle {
  input: ModuleUpdateInput;
  /** Remove the rendered template; call once the plan has been built and executed. */
  cleanup: () => Promise<void>;
}

/**
 * The base as a `ModuleUpdateInput` the existing classifier can run (#120). The bundled
 * template is rendered for this project into a temp dir and described as a one-scaffold
 * descriptor rooted at the project, so `listModuleFiles` places each file where `init`
 * put it. There is no `base` revision — the old template lives inside the old CLI, which
 * is not on disk — so the plan takes the `noMergeBase` path modules already have. Seed
 * files are left out of the descriptor and named in `ignoreTargets`, and every recorded
 * patch against a shipped file is queued for re-apply.
 *
 * No `dependencies` are declared: the root `package.json` is itself a managed base file,
 * so a pin bump rides its overwrite or its merge plan rather than a second write path.
 */
export async function baseUpdateInput(
  args: BaseUpdateArgs
): Promise<BaseUpdateHandle> {
  const { root, manifest, lock, templateDir, cliVersion, comparison } = args;
  const render = await renderTemplate(root, templateDir);
  const seed = new Set((await readBaseDeclaration(templateDir)).seedFiles);
  const shipped = render.files.filter((file) => !seed.has(file.target));
  const targets = new Set(shipped.map((file) => file.target));
  return {
    input: {
      comparison,
      theirs: {
        dir: render.dir,
        item: {
          name: BASE_MODULE,
          type: "saasaloy:capability",
          scaffolds: [
            {
              workspace: ".",
              files: shipped.map((file) => ({
                path: file.from,
                target: file.target,
              })),
            },
          ],
        },
      },
      noMergeBase: BASE_NO_MERGE_BASE,
      intent: [],
      ignoreTargets: seed,
      reapplyPatches: manifest.patches.filter((patch) =>
        targets.has(patch.file)
      ),
      baseRecord: baseRecord(
        cliVersion,
        await templateHash(templateDir),
        lock.base?.name ?? DEFAULT_BASE_NAME
      ),
    },
    cleanup: render.cleanup,
  };
}
