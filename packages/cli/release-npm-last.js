// release-it's own npm plugin, registered as a local plugin so it publishes last (ADR 0062).
//
// release-it 21 runs its built-in plugins in the order npm, git, github, so npm published
// before the tag existed on GitHub. A published CLI reads the modules at the tag of its own
// version, so that order let a user install a CLI that names a tag nobody can fetch yet.
// release-it runs a local plugin after the built-in ones in its release step, and this
// class disables the built-in npm plugin, so the order becomes: git commit, tag and push,
// then the GitHub Release, then npm publish. Every other step, the version bump and the
// npm one-time password prompt included, is the built-in plugin's own code.
//
// The built-in plugin is not in release-it's package exports, so it is loaded by file
// path. `scripts/release-order.test.ts` loads this file, so a release-it upgrade that
// moves the plugin fails the gate rather than the release.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const releaseIt = dirname(
  createRequire(import.meta.url).resolve("release-it/package.json")
);
const { default: Npm } = await import(
  pathToFileURL(join(releaseIt, "lib", "plugin", "npm", "npm.js")).href
);

export default class NpmLast extends Npm {
  static disablePlugin() {
    return "npm";
  }
}
