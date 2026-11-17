import { existsSync } from "node:fs";
import path from "node:path";

// The project root, found from a folder inside the project rather than from git. `pnpm
// env:setup` and `pnpm dev:ports` run in a project scaffolded with `saasaloy init
// --no-git`, which has no repository, and in a project that sits inside another
// repository, where `git rev-parse --show-toplevel` would name the outer one. The root is
// the nearest folder that holds `pnpm-workspace.yaml`, which every project has.

const MARKER = "pnpm-workspace.yaml";

/** The nearest folder at or above `from` that holds `pnpm-workspace.yaml`. */
export function projectRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, MARKER))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No ${MARKER} in ${path.resolve(from)} or any folder above it. Run this from inside the project.`
      );
    }
    dir = parent;
  }
}
