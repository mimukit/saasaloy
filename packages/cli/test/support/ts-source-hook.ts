// A resolve hook that lets plain `node` run the CLI from `src/` with no build, registered
// with `node --experimental-transform-types --import ./test/support/ts-source-hook.ts`.
//
// The source imports its siblings as `./cli.js` (NodeNext wants the emitted name), and
// only `dist/` holds those files. The unit suite never builds `dist/`, so the closed-stdin
// test in `src/commands/no-tty.test.ts` spawns `src/index.ts` and this hook maps a
// relative `.js` specifier that does not resolve onto the `.ts` beside it. Anything else
// falls through to Node's own answer. `scripts/ts-resolve-hook.ts` solves the opposite
// gap (extensionless imports in module payloads) and stays separate.
//
// It also answers a `?raw` import (src/lib/kits.ts reads the kit blocks so) with the
// file's text as the default export, the way vitest and the tsup build do.
//
// `--experimental-transform-types` rather than plain type stripping: `lib/registry.ts`
// uses a constructor parameter property, which strip-only mode rejects.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const RELATIVE_JS = /^\.\.?\/.*\.js$/;
const RAW = "?raw";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(RAW) && context.parentURL !== undefined) {
      const url = new URL(specifier.slice(0, -RAW.length), context.parentURL);
      return { shortCircuit: true, url: `${url.href}${RAW}` };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!RELATIVE_JS.test(specifier)) {
        throw error;
      }
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(RAW)) {
      return nextLoad(url, context);
    }
    const text = readFileSync(
      fileURLToPath(url.slice(0, -RAW.length)),
      "utf-8"
    );
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(text)};`,
    };
  },
});
