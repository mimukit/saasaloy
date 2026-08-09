// The pre-commit half of `pnpm lint`, scoped to staged files.
//
// It deliberately does NOT run the type-aware pass (`pnpm lint:types`): type-aware
// linting needs the whole project graph, which defeats the point of scoping to
// staged files. `pnpm lint` — in CI, or by hand — is what catches those.
//
// Keep these globs in step with the `lint` scripts in package.json. Markdown is
// absent on purpose: `.prettierignore` excludes it because Ultracite's Prettier
// sets `proseWrap: "never"`.
export default {
  "*.{js,jsx,mjs,cjs,ts,tsx,astro}": [
    "oxlint -c oxlint.config.mjs --fix --deny-warnings",
    "prettier --write",
  ],
  "*.css": ["stylelint --fix --max-warnings 0", "prettier --write"],
  "*.{json,jsonc,yaml,yml}": ["prettier --write"],
};
