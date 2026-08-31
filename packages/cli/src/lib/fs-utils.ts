import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  symlink,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { RefusalError } from "./exit.js";

/** sha256 hex digest of a string — used to fingerprint managed files in the manifest. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Resolve a project-relative POSIX path (a manifest key, a manifest link value, a
 * descriptor target) to an absolute path that is guaranteed to sit inside `root`.
 *
 * The state files this resolves from are persisted JSON, so their keys are only as
 * trustworthy as the last process that wrote them. `join()` silently normalizes a
 * `..` segment, which is how a corrupt or hand-edited manifest turns into a delete
 * outside the project. Reject the shape up front rather than trusting the result.
 *
 * @param hint appended to the refusal, naming where the bad path came from.
 * @throws {Error} if the path is absolute, contains a `..`/`.`/empty segment, carries a
 *   platform-specific separator, or otherwise escapes `root`.
 */
export function resolveWithinRoot(
  root: string,
  relPosixPath: string,
  hint = "This usually means the state file that recorded it is corrupt or was hand-edited."
): string {
  const reject = (why: string): never => {
    throw new RefusalError(
      `Refusing to resolve ${JSON.stringify(relPosixPath)}: ${why}. ${hint}`
    );
  };

  // A backslash also covers `C:\…`, so drive-letter paths never reach the resolve below.
  if (relPosixPath.includes("\\")) {
    reject("paths must use '/' separators");
  }
  if (isAbsolute(relPosixPath) || /^[a-zA-Z]:/.test(relPosixPath)) {
    reject("path must be project-relative");
  }

  const segments = relPosixPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    reject("path must not contain empty, '.' or '..' segments");
  }

  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, ...segments);
  // Belt and braces: catches anything the segment checks above missed (symlinked
  // roots, exotic normalization) before a caller deletes what comes back.
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    reject("path escapes the project root");
  }

  return abs;
}

/**
 * Reject a path that reaches its target through a symlink, at any component below `root`.
 *
 * `resolveWithinRoot` proves only that the *lexical* path stays inside the project. Every
 * `readFile`/`writeFile` that follows resolves links, so a symlink planted anywhere along
 * the path turns an in-root state-file entry into a read or write outside the project.
 * Walk the components from `root` down and refuse the first link found.
 *
 * A component that doesn't exist yet ends the walk: there is no link to follow, and
 * whether the caller may create it is its own question.
 *
 * @throws {Error} if any component of `abs` below `root` is a symlink.
 */
export async function assertNoSymlinkPath(
  root: string,
  abs: string
): Promise<void> {
  const rootAbs = resolve(root);
  const rel = relative(rootAbs, resolve(abs));
  if (rel === "") {
    return;
  }

  let current = rootAbs;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(current);
    } catch {
      return; // not on disk yet — nothing here can be followed
    }
    if (stat.isSymbolicLink()) {
      throw new RefusalError(
        `Refusing to touch ${JSON.stringify(rel.split(sep).join("/"))}: ${JSON.stringify(segment)} is a symlink, and following it would leave the project root. This usually means the state file that recorded the path is corrupt or was hand-edited.`
      );
    }
  }
}

/**
 * Recursively list the files under `dir` as POSIX paths relative to it. Used to expand
 * an `agent.skills` folder into the individual files a module ships, by both the
 * applier (at add time) and the updater (comparing two SHAs of the same folder).
 */
export async function listFilesRelative(
  dir: string,
  prefix = ""
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFilesRelative(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Names of the immediate subdirectories of `dir` (skips files); `[]` if `dir` is missing
 * or isn't a directory at all.
 *
 * Anything else — a permission error, an I/O failure — is rethrown rather than folded
 * into that empty array. Both callers loop over the result, so a swallowed error reads
 * as "there was nothing here", and the caller reports neither the work nor the reason
 * it didn't happen.
 *
 * @throws {Error} if `dir` exists but cannot be read.
 */
export async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
}

/**
 * Resolve a descriptor-authored POSIX source path under a module folder.
 *
 * A module folder is a temp dir or a local checkout, so it is the root here rather than
 * the project. The path itself comes from an untrusted `registry-item.json`: Phase 1
 * guarded every write *target* and left the read side on a bare `join`, which normalizes
 * a `..` away silently, so `"path": "../../../etc/passwd"` with an in-root target copied
 * a host file into the project. Same guard, module folder as the root (#98).
 *
 * @throws {RefusalError} if the source path escapes the module folder.
 */
export function joinModulePath(dir: string, relPosix: string): string {
  return resolveWithinRoot(
    dir,
    relPosix,
    "A module's source paths must stay inside the module folder; this descriptor is malformed or hostile."
  );
}

/** The file's content, or `undefined` when nothing is at that path. */
export async function readIfPresent(abs: string): Promise<string | undefined> {
  return (await pathExists(abs)) ? readFile(abs, "utf-8") : undefined;
}

/** True if the path exists (file, dir, or symlink). */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

// How a would-be directory symlink relates to what's already at its path:
//   missing  — nothing there, safe to create
//   correct  — already a symlink/junction resolving to the intended target (idempotent no-op)
//   conflict — a real file/dir, or a symlink pointing elsewhere (don't clobber)
export type LinkState = "missing" | "correct" | "conflict";

/** Classify a would-be directory symlink at `linkAbs` that should point to `targetAbs`. */
export async function classifyLink(
  linkAbs: string,
  targetAbs: string
): Promise<LinkState> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(linkAbs);
  } catch {
    return "missing";
  }
  if (!stat.isSymbolicLink()) {
    return "conflict";
  }
  // POSIX links read back relative to the link's own dir; Windows junctions read back absolute.
  const dest = await readlink(linkAbs);
  const resolved = resolve(dirname(linkAbs), dest);
  return resolved === resolve(targetAbs) ? "correct" : "conflict";
}

/**
 * Create a directory symlink that works cross-platform: a junction on Windows (needs no admin
 * rights and takes an absolute target) and a relative `dir` symlink elsewhere (so the project
 * stays portable when moved). Creates the parent directory first.
 */
export async function createDirLink(
  linkAbs: string,
  targetAbs: string
): Promise<void> {
  await mkdir(dirname(linkAbs), { recursive: true });
  await (process.platform === "win32"
    ? symlink(resolve(targetAbs), linkAbs, "junction")
    : symlink(relative(dirname(linkAbs), targetAbs), linkAbs, "dir"));
}
