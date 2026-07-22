import { defineConfig } from "vitest/config";

// Unit tests live beside the source they cover (src/**/*.test.ts) and run on the
// Node platform — the patch engine touches the filesystem-shaped APIs of magicast
// and jsonc-parser, not a browser DOM.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
