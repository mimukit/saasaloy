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

import { registerHooks } from "node:module";

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
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
