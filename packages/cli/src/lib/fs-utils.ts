import { createHash } from "node:crypto";
import { access, readdir } from "node:fs/promises";

/** sha256 hex digest of a string — used to fingerprint managed files in the manifest. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Names of the immediate subdirectories of `dir` (skips files); [] if `dir` is missing. */
export async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
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
