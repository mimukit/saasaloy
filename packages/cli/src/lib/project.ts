import { dirname, join, parse } from "node:path";
import { pathExists } from "./fs-utils.js";

// Walk up from `start` looking for a Saasaloy project marker so commands work from
// any subdirectory, like git. `package.json` is deliberately NOT a marker: in a
// monorepo every package has one, which would stop the search at the nearest
// package instead of the project root that owns saasaloy.json. Falls back to the
// starting dir when nothing is found.
const MARKERS = ["saasaloy.json"];

export async function findProjectRoot(start: string = process.cwd()): Promise<string> {
  let dir = start;
  const { root } = parse(dir);
  for (;;) {
    for (const marker of MARKERS) {
      if (await pathExists(join(dir, marker))) return dir;
    }
    if (dir === root) return start;
    dir = dirname(dir);
  }
}
