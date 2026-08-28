import { createHash } from "node:crypto";
import { access, lstat, mkdir, readdir, readlink, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** sha256 hex digest of a string — used to fingerprint managed files in the manifest. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
 * @throws if the path is absolute, contains a `..`/`.`/empty segment, carries a
 *   platform-specific separator, or otherwise escapes `root`.
 */
export function resolveWithinRoot(root: string, relPosixPath: string): string {
  const reject = (why: string): never => {
    throw new Error(`Refusing to resolve ${JSON.stringify(relPosixPath)}: ${why}. This usually means the state file that recorded it is corrupt or was hand-edited.`);
  };

  // A backslash also covers `C:\…`, so drive-letter paths never reach the resolve below.
  if (relPosixPath.includes("\\")) reject("paths must use '/' separators");
  if (isAbsolute(relPosixPath) || /^[a-zA-Z]:/.test(relPosixPath)) reject("path must be project-relative");

  const segments = relPosixPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    reject("path must not contain empty, '.' or '..' segments");
  }

  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, ...segments);
  // Belt and braces: catches anything the segment checks above missed (symlinked
  // roots, exotic normalization) before a caller deletes what comes back.
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) reject("path escapes the project root");

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
 * @throws if any component of `abs` below `root` is a symlink.
 */
export async function assertNoSymlinkPath(root: string, abs: string): Promise<void> {
  const rootAbs = resolve(root);
  const rel = relative(rootAbs, resolve(abs));
  if (rel === "") return;

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
      throw new Error(
        `Refusing to touch ${JSON.stringify(rel.split(sep).join("/"))}: ${JSON.stringify(segment)} is a symlink, and following it would leave the project root. This usually means the state file that recorded the path is corrupt or was hand-edited.`,
      );
    }
  }
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
 * @throws if `dir` exists but cannot be read.
 */
export async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
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
export async function classifyLink(linkAbs: string, targetAbs: string): Promise<LinkState> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(linkAbs);
  } catch {
    return "missing";
  }
  if (!stat.isSymbolicLink()) return "conflict";
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
export async function createDirLink(linkAbs: string, targetAbs: string): Promise<void> {
  await mkdir(dirname(linkAbs), { recursive: true });
  if (process.platform === "win32") {
    await symlink(resolve(targetAbs), linkAbs, "junction");
  } else {
    await symlink(relative(dirname(linkAbs), targetAbs), linkAbs, "dir");
  }
}
