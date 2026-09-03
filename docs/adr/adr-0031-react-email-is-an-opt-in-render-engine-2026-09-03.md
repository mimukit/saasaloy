# 0031 — React Email is an opt-in render engine, rendered at request time

`plan-email-capability-module-2026-08-04.md` ruled React Email out in one line: "`react-dom/server` in the api Worker is bundle weight every project pays for". The premise was right and the conclusion was scoped to a registry that had no way to say "only if you ask for it". Saasaloy's registry does say that. So the objection is answered by the shape of the module rather than by rejecting the library: **React Email ships as a separate opt-in feature module, `email-react`, which scaffolds `packages/email-react`.** A project that never runs `saasaloy add email-react` gets exactly the `packages/email` it got before — zero runtime dependencies, no React, no change to the tagged-template idiom, and no change to any provider.

**Templates render at request time, inside the Worker.** Template props are per-recipient: a display name, a one-time reset URL, an invitation token. Rendering at build time therefore cannot render the message, only a shell with holes in it, and filling those holes at request time is a hand-rolled template engine sitting underneath a real one. The cost of request-time rendering is bundle size, and that is measured below rather than guessed at.

**The measured delta carries no budget.** The number is recorded so a reader can decide with it, not gated on. A gate would re-litigate a cost only opting-in projects bear, which is the same mistake the 2026-08-04 line made.

## Status

accepted — reverses §Templating of `docs/plans/plan-email-capability-module-2026-08-04.md`. Planned in `docs/plans/plan-email-react-templates-2026-09-03.md` (grilled 2026-09-03), implemented for issue [#59](https://github.com/mimukit/saasaloy/issues/59). Nothing in `packages/email` changes except one name added to its barrel (`safeUrl`, already exported from `render.ts`); `provider.ts`, `define.ts` and `render.ts` are untouched, as is every `email-<provider>` module.

## Considered Options

- **Patch React and `.tsx` templates into `packages/email` itself.** Rejected. It ends the core's zero-runtime-dependency claim for every project that installs `email` at all, and it needs the JSX compiler option added to a tsconfig the core owns — the applier has no tsconfig patch kind, so there is no mechanism for it. A separate workspace ships its own tsconfig and needs no patch.
- **Render at build time and substitute placeholders at request time.** Rejected. See above: with per-recipient props, this is a worse template engine wearing React Email's name.
- **Widen the core contract to `EmailTemplate<Props> = (props) => EmailContent | Promise<EmailContent>`.** Rejected, and this is the one place the issue's own wording had to give. `@react-email/render@2.1.0` resolves to `dist/edge/*` under the `workerd` export condition, where `render()` returns `Promise<string>`, so a JSX template cannot be the core's synchronous `EmailTemplate<Props>`. Widening the core would push a union onto every tagged template's caller — including projects that never install this module — to spare JSX callers one `await`. Instead `packages/email-react` declares its own type, `ReactEmailTemplate<Props> = (props: Props) => Promise<EmailContent>`, and the JSX call site reads `await mail.send({ to, ...(await welcome(props)) })`. Providers see the identical `{ subject, html, text }` object either way, because `EmailContent` is unchanged.
- **A numeric bundle budget in CI.** Rejected — see the third paragraph above.
- **A JSX twin of the tagged `layout()`.** Rejected. Templates compose `@react-email/components` primitives directly, so there is no second bespoke layout to keep in step with the first.
- **Derive `text` with the core's `deriveText()`.** Rejected. `deriveText()` reads the single-column markup `layout()` emits; React Email emits nested tables. The helper calls `render(element, { plainText: true })`, React Email's own plaintext renderer, and `deriveText()` never sees JSX output.

## Consequences

- **The Worker bundle grows by 256 KiB gzipped when a route imports a JSX template.** Measured in `.dev/playground` with `email`, `email-console` and `email-react` installed, on `wrangler 4.127.1`, with `wrangler deploy --dry-run --outdir` and `gzip -c <outdir>/index.js | wc -c`. One route, differing only in which `welcome` it imports:

  | Route imports | Bundle | gzipped |
  |---|---|---|
  | `@repo/email/templates/welcome` (tagged) | 85,175 B | **22,239 B** |
  | `@repo/email-react/templates/welcome` (JSX) | 1,281,354 B | **284,871 B** |
  | delta | +1,196,179 B | **+262,632 B** (+256.5 KiB, 12.8×) |

  The byte counts are for the throwaway route measured on 2026-09-03. A route of a different size moves both rows and leaves the delta where it is.

  For scale, a Worker's compressed size limit is 3 MiB on the free plan and 10 MiB on paid, so 278 KiB is not close to either. The weight is `react-dom/server` plus the component set, and it is paid per Worker that imports a JSX template, not per project that installs the module.

- **A JSX template is async and a tagged template is not.** That difference is visible at every call site and is deliberately not hidden. Forgetting the `await` spreads a promise into the message, which TypeScript catches.
- **`packages/tsconfig/base.json` in the base template gains `"jsx": "react-jsx"`.** Internal packages are consumed as source, so `apps/api`'s own `tsc --noEmit` compiles `packages/email-react/src/templates/*.tsx` the moment a route imports one, under `apps/api`'s tsconfig rather than this package's. Without the option in the shared base that run fails `TS6142: … but '--jsx' is not set`, and there is no tsconfig patch kind to add it at `add` time. The option is inert for a workspace holding no `.tsx` file, and `packages/ui` already set it locally.
- **`react` and `@types/react` are pinned in two places that land in one project**, `modules/email-react/files/package.json` and `packages/cli/templates/base/packages/ui/package.json`. Neither file is a pnpm workspace member of this repo, so nothing in `pnpm outdated` sees a skew and a scaffolded project would install two Reacts silently. `scripts/verify-pins.ts` holds a declarative rule table and runs first inside `pnpm deps:verify`, ahead of `play:init`, so the cheap check fails before the multi-minute playground build. `update-deps.ts`'s existing divergence notes stay informational across every manifest; a gate there would fail on unrelated version splits.
- **`react-dom` is declared explicitly.** `@react-email/render@2.1.0` lists `react` and `react-dom` as **peer** dependencies, not dependencies, so "it comes in transitively" is only true through pnpm's auto-install-peers behaviour. The scaffolded `package.json` names it.
- **The preview server needs two devDependencies, not one.** The `react-email` package installs its CLI under the bin name `email`, not `react-email`, and `react-email@6.9.3` stops on an interactive "install `@react-email/ui`?" prompt when that package is absent — which hangs any non-interactive run. Both are devDependencies of `packages/email-react`, so neither reaches a deploy.

- **The preview server pins port 3002.** The CLI defaults to 3000, which the base template's `apps/web` already holds with `strictPort`, and the root `pnpm dev` runs `turbo run dev` across every workspace at once, so the default would collide on every scaffolded project. The `dev` script reads `email dev --dir src/templates --port 3002`, taking the next free port in the frontend block after `apps/admin` on 3001.

- **The scaffolded `tsconfig.json` sets `"jsx": "react-jsx"` and nothing else.** It carries no `"types": ["@cloudflare/workers-types"]`, which is the one place it diverges from `packages/email`'s tsconfig. No file in `packages/email-react` reads a Worker global, and the preview CLI compiles the same templates under Node, so the entry would add a devDependency and a runtime assumption the package does not use. A template that reaches for a Worker global needs both added back.
- **No unit test ships under `modules/email-react/files/`.** `pnpm test:modules` globs `modules/*/files/**/*.test.ts` and Node's type stripping does not transform JSX, so a `.tsx` test would be neither collected nor runnable. The module is verified through the playground instead: `pnpm typecheck`, an end-to-end send through `email-console`, and the preview server. `scripts/verify-pins.test.ts` covers the pin rule under `pnpm test:scripts`.
- **Guidance travels with the module.** `modules/email-react/skills/saasaloy-email-react/SKILL.md` is listed in `agent.skills[]` and copied into the consumer's `.claude/skills/` by `add`; `saasaloy-email` gains a pointer to it rather than absorbing its content.

## References

Plans: `docs/plans/plan-email-react-templates-2026-09-03.md` (this decision), `docs/plans/plan-email-capability-module-2026-08-04.md` §Templating (reversed here). Prior: [ADR 0014](adr-0014-saasaloy-prefixed-module-skill-names-2026-07-23.md), [ADR 0020](adr-0020-capability-owns-its-vendor-packages-2026-07-24.md). Code: `modules/email-react/`, `scripts/verify-pins.ts`, `packages/cli/templates/base/packages/tsconfig/base.json`. Issues: [#59](https://github.com/mimukit/saasaloy/issues/59), [#15](https://github.com/mimukit/saasaloy/issues/15).
