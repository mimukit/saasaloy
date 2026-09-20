import { existsSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { rimraf } from "rimraf";

// `pnpm db:drop`: delete the local D1 database, which on this driver means deleting the
// directory wrangler keeps it in. It touches nothing remote: `wrangler d1 delete` is a
// separate, deliberate command and this script never runs it.
//
// `apps/api/.wrangler/state/v3/d1` is wrangler's own layout, not ours. A wrangler upgrade
// that moves it makes this a no-op that says so, rather than a delete somewhere else, which
// is why the path is checked twice before rimraf sees it: it must resolve under the project
// root, and it must be a directory.

const ROOT = resolve(process.cwd(), "../..");
const D1_STATE = resolve(ROOT, "apps/api/.wrangler/state/v3/d1");

function refuse(why: string): void {
  process.stderr.write(`Refusing to delete ${D1_STATE}: ${why}.\n`);
  process.exitCode = 1;
}

const inside = relative(ROOT, D1_STATE);
if (inside.startsWith("..") || inside.split(sep).includes("..")) {
  refuse("it does not resolve under the project root");
} else if (!existsSync(D1_STATE)) {
  process.stdout.write(
    `No local D1 database at ${D1_STATE}. Nothing to drop. A wrangler upgrade may have moved the path; check apps/api/.wrangler/state.\n`
  );
} else if (statSync(D1_STATE).isDirectory()) {
  await rimraf(D1_STATE);
  process.stdout.write(
    `Dropped the local D1 database (${D1_STATE}). Run pnpm db:setup to create it again.\n`
  );
} else {
  refuse("it is not a directory, so it is not wrangler's D1 state");
}
