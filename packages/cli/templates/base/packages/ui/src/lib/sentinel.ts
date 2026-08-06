// Canary for the tool repo's `scripts/verify-css.mjs` smoke test. Tailwind's class
// detection is text-based — it scans source files as plain text and never imports them —
// so this constant needs no consumer to make the utility below reach the built CSS. It
// reaches it only if globals.css's `@source "../**/*.{ts,tsx}"` glob is actually
// matching packages/ui, which is the exact failure the smoke test exists to catch.
//
// The utility is an arbitrary property (`[--saasaloy-css-probe:1]`) so it compiles to a
// custom property nothing reads and nothing renders. The name is deliberately unique:
// verify-css.mjs also asserts it appears nowhere in apps/web, so a passing test can only
// mean the packages/ui glob worked. Deleting this file breaks that test, not the build.
export const CSS_PROBE_CLASS = "[--saasaloy-css-probe:1]";
