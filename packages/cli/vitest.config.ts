import { defineConfig } from "vitest/config";

// Unit tests live beside the source they cover (src/**/*.test.ts) and run on the
// Node platform — the patch engine touches the filesystem-shaped APIs of magicast
// and jsonc-parser, not a browser DOM.
export default defineConfig({
  test: {
    // `pnpm test` passes `--coverage`, so these options decide what the number
    // means. No threshold is set yet: the audit asked CI to *report* coverage, and
    // a gate picked before anyone has read one run's report is a number invented,
    // not measured. Add `thresholds` here once the baseline is known.
    //
    // Measured on 2026-09-01, after #47's suite landed: 82.5% statements, 77.1%
    // branches, 82.6% functions, 82.6% lines. The plan's closing step is to pin the
    // threshold two points under whichever of those the gate should watch.
    coverage: {
      // `templates/` and `schemas/` are shipped assets, not code this suite runs.
      include: ["src/**/*.ts"],
      provider: "v8",
      // `text` prints the table in the CI log; `lcovonly` leaves coverage/lcov.info
      // on disk for a reporting service to pick up later. Both land in coverage/,
      // which .gitignore already covers.
      //
      // `lcovonly`, not `lcov`: the latter also writes an HTML report whose bundled
      // stylesheets `pnpm lint:css` then walks and rejects, ~111 findings in
      // third-party CSS. Adding `html` for a local read means keeping the
      // `coverage/**` entries in stylelint.config.js and .prettierignore.
      reporter: ["text", "lcovonly"],
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
