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

//
// It also maps a short allowlist of **workspace** specifiers onto the module that ships
// them, because a payload file may legitimately import another capability's core:
// `modules/billing-bkash-merchant/files/bkash-merchant.ts` imports `@repo/kv` for the store
// its token lives in, and its descriptor patches that dependency into
// `packages/billing/package.json` (ADR 0040). A bare package name resolves through
// `node_modules` and there is no `@repo/kv` there in this repo, so without the mapping the
// provider's tests cannot load the file at all.
//
// The allowlist is deliberate rather than a general `@repo/*` rule. Several payload files
// import `@repo/db/client` and are written on the assumption that the import does *not*
// resolve here (see `modules/auth/files/src/db-scope.ts`); making it resolve would pull
// drizzle and a driver into a run that has neither. Add an entry when a payload test needs
// one, and not before.

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

/** Workspace package → the module payload that scaffolds it, from the repo root. */
const WORKSPACE_MODULES: Record<string, string> = {
  "@repo/kv": "modules/kv/files/src/index.ts",
};

const repoRoot = new URL("../", pathToFileURL(import.meta.filename));

registerHooks({
  resolve(specifier, context, nextResolve) {
    const workspace = WORKSPACE_MODULES[specifier];
    if (workspace) {
      const target = new URL(workspace, repoRoot);
      if (existsSync(fileURLToPath(target))) {
        return { shortCircuit: true, url: target.href };
      }
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
