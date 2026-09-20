// A module resolve hook for `pnpm test:modules`, registered by importing this file:
// `node --import ./scripts/ts-resolve-hook.ts --test "modules/*/files/**/*.test.ts"`.
//
// Shipped payload code under `modules/*/files/` imports without a file extension
// (`import { defineQueue } from "./define"`), because the scaffolded project compiles it
// with `moduleResolution: "Bundler"` and does not set `allowImportingTsExtensions`.
// Node's ESM resolver is stricter: it wants the real filename, so a payload test that
// pulls in a module which imports a sibling fails with ERR_MODULE_NOT_FOUND before a
// single assertion runs. A test file can carry the `.ts` itself; it cannot fix the
// imports inside the payload, and adding them there would put a non-portable extension
// into every generated project.
//
// The hook closes that gap and nothing else: an extensionless *relative* specifier gets
// `.ts` appended, then `/index.ts`, and anything that still does not resolve falls
// through to Node's own answer, so a bare package name or an explicit extension behaves
// exactly as before.

// It also resolves the one workspace package a payload file may import that is not payload
// itself: `@repo/config` ships in the base template, so a tested module file reading
// `config.auth.adminRole` would otherwise fail on a bare specifier no node_modules holds.
// `./config-shim.ts` composes that object the way an installed project does; the `/define`
// subpath goes straight to the template source, since a section file only needs the helper.
// The map is deliberately closed — two entries — rather than a general workspace resolver,
// because every other `@repo/*` package is scaffolded by a module and is not on disk in this
// repo at all.

import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

const here = import.meta.dirname;
const WORKSPACES = new Map([
  ["@repo/config", pathToFileURL(join(here, "config-shim.ts")).href],
  [
    "@repo/config/define",
    pathToFileURL(
      join(here, "../packages/cli/templates/base/packages/config/src/define.ts")
    ).href,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const workspace = WORKSPACES.get(specifier);
    if (workspace) {
      return { shortCircuit: true, url: workspace };
    }
    if (!RELATIVE.test(specifier) || HAS_EXTENSION.test(specifier)) {
      return nextResolve(specifier, context);
    }

    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return nextResolve(candidate, context);
      } catch {
        // Try the next shape. The fall-through below reports Node's own error for the
        // specifier the payload actually wrote, which is the one a reader can act on.
      }
    }

    return nextResolve(specifier, context);
  },
});
