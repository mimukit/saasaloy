import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsup";
import type { Options } from "tsup";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

// `import text from "./file.tsx?raw"` bundles the file's text, the way Vite reads the same
// query under vitest. src/lib/kits.ts takes the kit blocks (templates/kits/) so, which
// keeps the render pure: no disk read for a kit file at run time.
const rawText: EsbuildPlugin = {
  name: "raw-text",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      namespace: "raw-text",
      path: resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
    }));
    build.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => ({
      contents: await readFile(args.path, "utf-8"),
      loader: "text",
    }));
  },
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  sourcemap: true,
  esbuildPlugins: [rawText],
  // tsup preserves the source shebang, so `dist/index.js` stays executable.
});
