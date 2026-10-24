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
// `--experimental-transform-types` rather than plain type stripping: `lib/registry.ts`
// uses a constructor parameter property, which strip-only mode rejects.

import { registerHooks } from "node:module";

const RELATIVE_JS = /^\.\.?\/.*\.js$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!RELATIVE_JS.test(specifier)) {
        throw error;
      }
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
});
