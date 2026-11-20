import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RefusalError } from "../lib/exit.js";
import {
  hashContent,
  pathExists,
  readIfPresent,
  resolveWithinRoot,
} from "../lib/fs-utils.js";
import { formatSource } from "../lib/format.js";
import { loadLock, saveLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { loadManifest, MANIFEST_FILE } from "../lib/manifest.js";
import type { ManagedEntry } from "../lib/manifest.js";
import { resolveProjectName } from "../lib/project-name.js";
import { DEFAULT_SOURCE } from "../lib/registry.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import { templateVars } from "../lib/scaffold.js";
import { compareVersions, parseVersion } from "../lib/semver.js";
import { readTestingMode } from "../lib/testing.js";
import type { ApplySide, SourceFormatter } from "./apply.js";
import type { FileClass } from "./classes.js";
import {
  MANIFEST_VERSION,
  payloadTemplateHash,
  saveManifestV2,
} from "./manifest.js";
import type { FileRecord, ManifestV2 } from "./manifest.js";
import { LOCAL_SOURCE } from "./payload.js";
import { copiedContent, render } from "./render.js";
import type { RenderedFile, RenderOptions, RenderResult } from "./render.js";
import { isLocalRegistry, loadSide } from "./project.js";
import type { LoadSideContext, ModuleCoordinate } from "./project.js";

// The conversion of a version 1 project (plan 0116, Phase 5; research 0013, "The base of
// a file"). The old engine recorded, for each file it copied, the module, the source path
// (`from`) and the sha256 of the bytes it wrote before any patch ran. A version 2 record
// names the render instead: the sha256 of the raw render and the release that wrote it,
// so a later run renders that release again and takes it as the base of a merge.
//
// The method is the research's. For each tracked file, the candidates are the lock's own
// release (`base.cliVersion`), every release of the old engine, newest first, and the
// commits the lock's modules resolved to. At each candidate the conversion renders the
// project's set, keeping the modules that release can load, and compares the recorded
// hash with the bytes the render copies for that source before its patches. A match is
// the base. Its record takes the hash of the whole render of the file and the version of
// the candidate.
//
// When several candidates match, their renders differ only for a file a patch or the set
// changes (`package.json`, a table file, `saasaloy.json`). The conversion then takes the
// render nearest the disk, which is the render the old engine left there when the owner
// did not edit the file. Otherwise the first candidate in the order above wins.
//
// A file with no match keeps no record. The next run finds it on both sides with no
// base, which the plan's "both sides" rule handles. A file the owner deleted keeps a
// record, so it stays deleted.

/** The last CLI on the old engine: what a project that cannot convert updates with first. */
export const LAST_OLD_ENGINE_CLI = "0.9.0";

/** Every release of the old engine. A conversion searches those at or below the running CLI. */
export const OLD_ENGINE_RELEASES: readonly string[] = [
  "0.1.0",
  "0.1.1",
  "0.2.0",
  "0.3.0",
  "0.4.0",
  "0.5.0",
  "0.5.1",
  "0.5.2",
  "0.6.0",
  "0.6.1",
  "0.7.0",
  "0.8.0",
  "0.9.0",
];

/**
 * Loads the side of one candidate: the project's set at `version` (a release or a commit
 * SHA), holding only the modules that version can load. `undefined` when it cannot load.
 */
export type CandidateLoader = (
  version: string,
  requested: readonly string[],
  options: RenderOptions
) => Promise<ApplySide | undefined>;

export interface ConvertArgs {
  root: string;
  load: CandidateLoader;
  /** The releases to search besides the lock's own refs. */
  releases: readonly string[];
  /** Formats a patched file as the project would. The project's Prettier by default. */
  format?: SourceFormatter;
}

/** What the conversion found for one tracked file. */
export interface ConvertedFile {
  path: string;
  module: string;
  from: string;
  /** The version whose render matched the recorded hash; absent when none did. */
  version?: string;
  /** The version 2 record, absent for a file that becomes a both-sides file. */
  record?: FileRecord;
}

/** True when the base came from another source of the same module: a driver variant. */
export function isVariant(file: ConvertedFile): boolean {
  return file.record !== undefined && file.record.from !== file.from;
}

export interface Conversion {
  lock: Lockfile;
  manifest: ManifestV2;
  /** One entry for each file the version 1 manifest tracked, in path order. */
  files: ConvertedFile[];
  /** Every candidate searched, in order. */
  searched: string[];
  /** Candidates that could not load or render, and why. */
  warnings: string[];
}

/** Lock refs a conversion can render: a release tag or a commit SHA. */
function versionOfRef(ref: string): string | undefined {
  if (/^[0-9a-f]{40}$/.test(ref)) {
    return ref;
  }
  const tag = /^v(\d+\.\d+\.\d+)$/.exec(ref);
  return tag?.[1];
}

/**
 * Refuse a version 1 manifest that lacks a source path or a hash for some file: with no
 * `from` there is no source to render, and with no hash no render can be proved.
 */
export function assertConvertible(raw: unknown): void {
  const managed =
    typeof raw === "object" && raw !== null && "managed" in raw
      ? raw.managed
      : undefined;
  const missing: string[] = [];
  if (typeof managed === "object" && managed !== null) {
    for (const [path, entry] of Object.entries(managed)) {
      const record = entry as { hash?: unknown; from?: unknown };
      if (typeof record.hash !== "string" || typeof record.from !== "string") {
        missing.push(path);
      }
    }
  }
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).map((path) => `  ${path}`);
    const more =
      missing.length > shown.length
        ? [`  …and ${String(missing.length - shown.length)} more`]
        : [];
    throw new RefusalError(
      [
        `${MANIFEST_FILE} records files with no source path or no hash, so the render engine cannot find their base:`,
        ...shown,
        ...more,
        `Run \`pnpm dlx saasaloy@${LAST_OLD_ENGINE_CLI} update\` first: it records both for every file. Then run this command again. Nothing was written.`,
      ].join("\n")
    );
  }
}

/** Lines in one text and not the other, counted both ways. */
function lineDistance(a: string, b: string): number {
  const count = new Map<string, number>();
  for (const line of a.split("\n")) {
    count.set(line, (count.get(line) ?? 0) + 1);
  }
  for (const line of b.split("\n")) {
    count.set(line, (count.get(line) ?? 0) - 1);
  }
  let total = 0;
  for (const value of count.values()) {
    total += Math.abs(value);
  }
  return total;
}

interface Candidate {
  version: string;
  side: ApplySide;
  rendered: RenderResult;
}

/**
 * Convert a version 1 project in memory: the version 2 manifest and the lock with its
 * `requested` list. Writes nothing; `writeConversion` writes the result.
 */
export async function convertProject(args: ConvertArgs): Promise<Conversion> {
  const { root } = args;
  const file = join(root, MANIFEST_FILE);
  if (!(await pathExists(file))) {
    throw new RefusalError(
      `${MANIFEST_FILE} is missing, so there is nothing to convert.`
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (error) {
    throw new RefusalError(
      `${MANIFEST_FILE} is invalid:\n  ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  assertConvertible(raw);
  const v1 = await loadManifest(root);
  const lock = await loadLock(root);
  const config = await loadConfig(root);
  const options: RenderOptions = {
    projectName: (await resolveProjectName(root, config)).name,
    testingMode: readTestingMode(config),
  };

  // The modules the owner asked for. A version 1 lock does not say which modules came in
  // as a prerequisite, so every installed module counts as asked for: a later `remove`
  // then never takes a module the owner may have named.
  const requested = [
    ...new Set([...Object.keys(lock.modules), ...(config.installed ?? [])]),
  ].toSorted();

  const order: string[] = [];
  const push = (version: string | undefined): void => {
    if (version !== undefined && !order.includes(version)) {
      order.push(version);
    }
  };
  push(lock.base?.cliVersion);
  const newestFirst = [...args.releases].toSorted((a, b) => {
    const left = parseVersion(a);
    const right = parseVersion(b);
    return left === undefined || right === undefined
      ? 0
      : compareVersions(right, left);
  });
  for (const release of newestFirst) {
    push(release);
  }
  for (const entry of Object.values(lock.modules)) {
    push(versionOfRef(entry.resolved));
  }

  const warnings: string[] = [];
  const candidates: Candidate[] = [];
  for (const version of order) {
    let side: ApplySide | undefined;
    try {
      side = await args.load(version, requested, options);
    } catch (error) {
      warnings.push(
        `${version}: could not load — ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    if (side === undefined) {
      warnings.push(`${version}: could not load`);
      continue;
    }
    try {
      candidates.push({ rendered: render(side), side, version });
    } catch (error) {
      warnings.push(
        `${version}: could not render — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const format =
    args.format ??
    ((path: string, content: string) => formatSource(root, path, content));
  const read = (path: string): Promise<string | undefined> =>
    readIfPresent(resolveWithinRoot(root, path));
  const fallbackVersion = lock.base?.cliVersion ?? candidates[0]?.version;

  const files: ConvertedFile[] = [];
  const records: Record<string, FileRecord> = {};
  for (const path of Object.keys(v1.managed).toSorted()) {
    const entry = v1.managed[path] as ManagedEntry & { from: string };
    // A merge the old engine recorded holds the owner's bytes; its base is the module
    // version that merge took in.
    const want = entry.mergedWith ?? entry.hash;
    const matches: { version: string; file: RenderedFile }[] = [];
    const variants: { version: string; file: RenderedFile }[] = [];
    for (const candidate of candidates) {
      const copied = copiedContent(
        candidate.side.payload,
        { from: entry.from, module: entry.module, path },
        candidate.side.options.vars ??
          templateVars(candidate.side.options.projectName),
        candidate.rendered.testingMode
      );
      const rendered = candidate.rendered.files.get(path);
      if (
        copied === undefined ||
        hashContent(copied) !== want ||
        rendered === undefined ||
        rendered.module !== entry.module
      ) {
        continue;
      }
      // The same module may write the path from another source in this set: a driver
      // variant that `onlyWith` picks (`auth.sqlite.ts` recorded, `auth.pg.ts` gated in
      // after a move to Postgres). The release is proved by the recorded source; the base
      // is what that release renders at the path for the project's set.
      (rendered.from === entry.from ? matches : variants).push({
        file: rendered,
        version: candidate.version,
      });
    }

    const mine = await read(path);
    const chosen = await nearest(
      path,
      matches.length > 0 ? matches : variants,
      mine,
      format
    );
    if (chosen !== undefined) {
      const record: FileRecord = {
        class: chosen.file.class,
        from: chosen.file.from,
        hash: hashContent(chosen.file.content),
        module: entry.module,
        version: chosen.version,
      };
      records[path] = record;
      files.push({
        from: entry.from,
        module: entry.module,
        path,
        record,
        version: chosen.version,
      });
      continue;
    }
    if (mine === undefined && fallbackVersion !== undefined) {
      // The owner deleted it. The record stays, so the file stays deleted.
      const fileClass: FileClass = entry.seed === true ? "once" : "merged";
      const record: FileRecord = {
        class: fileClass,
        from: entry.from,
        hash: entry.hash,
        module: entry.module,
        version: fallbackVersion,
      };
      records[path] = record;
      files.push({ from: entry.from, module: entry.module, path, record });
      continue;
    }
    files.push({ from: entry.from, module: entry.module, path });
  }

  const manifest: ManifestV2 = {
    doneNotes: [...(v1.doneNotes ?? [])],
    files: records,
    pendingMerges: [],
    pendingNotes: [...(v1.pendingNotes ?? [])],
    version: MANIFEST_VERSION,
  };
  const newest = candidates[0];
  const base =
    lock.base ??
    (newest === undefined || fallbackVersion === undefined
      ? undefined
      : {
          cliVersion: fallbackVersion,
          name: config.base ?? "web",
          templateHash: payloadTemplateHash(newest.side.payload),
        });
  const converted: Lockfile = {
    ...lock,
    requested,
    ...(base === undefined ? {} : { base }),
  };
  return { files, lock: converted, manifest, searched: order, warnings };
}

/**
 * Among the renders whose copied source matched, the one to record: the only render when
 * they agree, else the render nearest the disk (raw or as the project's Prettier lays out
 * a patched file), the earlier candidate on a tie.
 */
async function nearest(
  path: string,
  matches: readonly { version: string; file: RenderedFile }[],
  mine: string | undefined,
  format: SourceFormatter
): Promise<{ version: string; file: RenderedFile } | undefined> {
  const first = matches[0];
  if (
    first === undefined ||
    mine === undefined ||
    matches.every((match) => match.file.content === first.file.content)
  ) {
    return first;
  }
  let best = first;
  let bestDistance = Number.POSITIVE_INFINITY;
  const seen = new Map<string, number>();
  for (const match of matches) {
    let distance = seen.get(match.file.content);
    if (distance === undefined) {
      const laid =
        match.file.transformed === true
          ? ((await format(path, match.file.content)) ?? match.file.content)
          : match.file.content;
      distance =
        laid === mine || match.file.content === mine
          ? 0
          : lineDistance(laid, mine);
      seen.set(match.file.content, distance);
    }
    if (distance < bestDistance) {
      best = match;
      bestDistance = distance;
    }
  }
  return best;
}

/** Write a conversion: the version 2 manifest, then the lock. */
export async function writeConversion(
  root: string,
  conversion: Pick<Conversion, "lock" | "manifest">
): Promise<void> {
  await saveManifestV2(root, conversion.manifest);
  await saveLock(root, conversion.lock);
}

/**
 * The candidate loader of a CLI run: `loadSide` at each version, keeping the modules that
 * version can load. A third-party module reads the commit its lock entry resolved.
 */
export function candidateLoader(
  lock: Lockfile,
  context: LoadSideContext
): CandidateLoader {
  const coordinates = new Map<string, ModuleCoordinate>();
  for (const [name, entry] of Object.entries(lock.modules)) {
    if (entry.source !== DEFAULT_SOURCE && entry.source !== LOCAL_SOURCE) {
      coordinates.set(name, {
        ref: entry.ref,
        resolved: entry.resolved,
        source: entry.source,
      });
    }
  }
  return async (version, requested, options) =>
    (
      await loadSide(
        { coordinates, options, partial: true, requested, version },
        context
      )
    ).side;
}

/**
 * The releases a CLI run searches: every old-engine release at or below the running CLI.
 * A local registry has one payload whatever the version, so it searches none beyond the
 * lock's own.
 */
export function searchedReleases(
  cliVersion: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): string[] {
  if (isLocalRegistry(env)) {
    return [];
  }
  const running = parseVersion(cliVersion);
  return OLD_ENGINE_RELEASES.filter((release) => {
    const parsed = parseVersion(release);
    return (
      running === undefined ||
      (parsed !== undefined && compareVersions(parsed, running) <= 0)
    );
  });
}
