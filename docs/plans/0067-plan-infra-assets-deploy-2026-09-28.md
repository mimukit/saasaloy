# Plan: deploy assets-only workers through `infra`

Grilled: 2026-09-28

## Context

Issue #180. The `infra` module (plan [0012](0012-plan-infra-capability-module-2026-07-25.md), ADR 0021) deploys a service by reading its `wrangler.jsonc`, building it, and uploading one script bundle. That covers `apps/api` and nothing else a project ships today.

Two shipped services are assets-only Workers, with an `assets` block and no `main`:

- the base's `apps/web`, an Astro site with every page prerendered (`directory: "./dist/client"`, `not_found_handling: "404-page"`)
- the `admin` module's app, a Vite SPA (`directory: "./dist"`, `not_found_handling: "single-page-application"`)

Both fail before anything deploys. `SUPPORTED_BINDING_KEYS` in `modules/infra/files/src/translate.ts` refuses `assets`, and `readBundle` wants a `dist/<name>/wrangler.json` with a `main` that neither build writes. The consumer project brainaloylabs/primeshopr is blocked on this (its issue #3).

Success is a fresh `saasaloy init` base plus `saasaloy add infra` that runs `stack:init`, `preview` and `deploy` with no prompt, serves the site with its 404 page and cache headers, and serves none of the build's private files.

### Facts the plan rests on

Checked on 2026-09-28 against a real build and the upstream sources.

- **The Astro build.** `dist/client` holds the site plus `wrangler.json`, `.assetsignore` (listing `wrangler.json` and `.dev.vars`) and `_headers` (`/_astro/*` gets `Cache-Control: public, max-age=31536000, immutable`). `dist/server` is empty.
- **The adapter's generated config adds nothing.** `dist/client/wrangler.json` carries no `main`, no `assets.binding`, no SESSION KV and no `images` binding. It only rewrites `assets.directory` to `"."`. Reading the source `wrangler.jsonc` is enough while every page is prerendered.
- **Wrangler's ignore rules** (4.129.0 `cli.js` around line 153694). It reads `.assetsignore` from the root of the assets directory only, matches with the npm `ignore` package against recursive relative paths, and always adds `/.assetsignore`, `/_headers` and `/_redirects`, anchored at the root. It sends root `_headers` / `_redirects` contents as asset config.
- **The provider** (`@pulumi/cloudflare` 6.20.0, pinned to terraform-provider-cloudflare v5.24.0). It uploads every file in `assets.directory`, dotfiles included, and reads no `.assetsignore`. `assets.config` takes `headers` and `redirects` as file contents, `notFoundHandling` (`none`, `404-page`, `single-page-application`) and `htmlHandling` (`auto-trailing-slash`, `force-trailing-slash`, `drop-trailing-slash`, `none`). An assets-only Worker is valid (`AtLeastOneOf(content, content_file, assets)`), and the script part is sent only when `content` is set.
- **Change detection.** The computed `assets.asset_manifest_sha256` hashes every file's content and relative path on each plan, not the absolute path. One changed file shows a diff, no change shows none, and nothing about assets forces replacement.
- **`wrangler secret put` on a missing Worker** uploads a placeholder script (`export default { fetch() {} }`) so it can attach the secret.
- **Module files are copied as named.** The `_x` to `.x` rename applies to the base template only. `{ "path": "files/_gitignore", "target": ".gitignore" }` works through `add`, the remote fetch, `update` and `remove`.
- **Service names are not checked for uniqueness** in `discover.ts`.
- **Modules are not versioned.** Only the CLI is tagged. A consumer pins a module with `mimukit/saasaloy@<ref>/infra`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Mechanism | Translate `assets` in the Pulumi program. No `wrangler deploy` shell-out, because Pulumi has to own the Worker to diff and destroy it. |
| Private files | Stage a filtered copy at `infra/.stage/<service>/` and point `assets.directory` at it. Never delete from the service's `dist/`, never change the service's build. |
| Ignore rules | Mirror wrangler exactly: the `ignore` package, exact-pinned; `.assetsignore` read from the assets root only; `/.assetsignore`, `/_headers` and `/_redirects` always excluded, anchored at the root. A nested `_headers` is copied like any file. |
| `_headers` / `_redirects` | Root file contents, when present, go to `assets.config.headers` / `redirects`. |
| Asset options | `not_found_handling` and `html_handling` map to `notFoundHandling` / `htmlHandling`. `assetManifestSha256` is computed by the provider and never set. |
| Assets-only path | `assets` and no `main`: skip `readBundle`, send no `content`, `contentSha256` or `mainModule`. A service with `main` and no `assets` keeps today's path unchanged. |
| `main` and `assets` together | Refuse before the build: `infra doesn't support 'assets' on a Worker with 'main' yet`. The skill names SSR as the case that lifts it. |
| Stage freshness | Remove `infra/.stage/<service>/` and copy again on every run, after the build. |
| Config source | The source `wrangler.jsonc`, as today. The adapter's generated file adds no binding. |
| Duplicate names | Discovery throws when two services resolve to one name, naming both paths, before any build. |
| Secrets | `pushSecrets` is skipped for an assets-only service with one log line: `infra: <name> has no Worker script — skipping secrets.` |
| Tests | Staging and mapping live in `src/stage.ts`, tested with vitest in the module like the other modules' `*.test.ts`. `infra/package.json` gets a `test` script. |
| Second case | The `admin` app is tested in `preview` and in the live deploy, so the path does not depend on Astro's layout. |
| First run | `stack:init` script (`pulumi stack init prod`) in the scaffolded `infra/package.json`. |
| Cleanup | `clean` script (`rimraf -g .stage "*.tsbuildinfo"`), `rimraf` exact-pinned. `infra/.gitignore`, scaffolded from `files/_gitignore`, lists `.stage/`. |
| Docs | The `saasaloy-infra` skill and the `CLOUDFLARE_API_TOKEN` text in `registry-item.json` state the new support, the one-time `stack:init`, `clean`, and the token scope ("Workers Scripts: Edit", plus D1 edit only when a service declares D1). |
| Release | The next CLI release after the merge carries the change. The skill shows the `mimukit/saasaloy@vX.Y.Z/infra` pin form. |
| ADR 0021 | No amendment. The implementation PR adds one References line: "Assets-only Workers: #180, plan 0067." |
| Broken base build | Out of this plan. A fresh base fails `astro build` today (`@cloudflare/vite-plugin` 1.57.1 needs `wrangler ^4.136.1`, the template pins `4.129.0`). A separate `fix(template)` issue, `critical`, fixes it. Only the Phase 3 live checks wait for it. |
| `pushSecrets` timing | Out of this plan. It runs during `preview` and before a first deploy creates the Worker. A separate `fix(infra)` issue, `high`, moves it to `up` only, after the script exists. |

## Approach

Extend `toResources` in `src/translate.ts`. It reuses what is there: discovery already hands over the parsed `wrangler.jsonc`, `buildService` already runs the service's build, and `WorkersScriptSubdomain` already follows each script. The new code is one module, `src/stage.ts`, exporting `stageAssets(serviceDir, assets, stageRoot)` that returns `{ directory, config }`, plus a branch in `toResources` that skips the bundle read.

`assets` joins `NON_BINDING_KEYS` rather than `SUPPORTED_BINDING_KEYS`, because it describes the Worker and produces no entry in `bindings`.

Rejected, a line each:

- `wrangler deploy` for assets-only services: Pulumi loses the Worker, so `destroy` misses it and `preview` cannot show it.
- Delete the ignored files from `dist/` before upload: it mutates the service's output, and a failed deploy leaves the build broken for `wrangler dev`.
- Point `assets.directory` at `dist/client` and accept the leak: it publishes `.dev.vars` and `wrangler.json`.
- Read the adapter's generated `wrangler.json`: it adds nothing today and ties `infra` to one framework's output path.

### Phase 1: translate an assets-only service (#180) (built 2026-09-28)

- [ ] `WranglerConfig` in `src/discover.ts` types the `assets` block (`directory`, `not_found_handling`, `html_handling`)
- [ ] discovery throws when two services resolve to one name, naming both paths
- [ ] `assets` with no `main` passes the pre-build check; `assets` with `main` throws the refusal message
- [ ] `stageAssets` removes `infra/.stage/<service>/`, copies `assets.directory` (resolved against the service directory) into it, and applies wrangler's ignore rules
- [ ] `stageAssets` returns root `_headers` / `_redirects` contents and the two handling options as the provider's `assets.config`
- [ ] vitest covers: an `.assetsignore` match left out, `.assetsignore` / root `_headers` / root `_redirects` left out, a nested `docs/_headers` kept, a nested `.assetsignore` ignored as a rule file, missing `_headers` giving no `headers` key, and a second run removing a file the first run staged
- [ ] the `WorkersScript` for an assets-only service carries the staged `assets.directory` and `assets.config`, and no `content`, `contentSha256` or `mainModule`
- [ ] a service with `main` produces the same `WorkersScript` inputs as before this change
- [ ] `index.ts` skips `pushSecrets` for an assets-only service with the log line
- [ ] `pulumi preview` against a base (with the build fix applied) lists one `WorkersScript` and one `WorkersScriptSubdomain` for `web` and throws nothing
- [ ] the same holds with `admin` added

### Phase 2: workspace scripts and ignore (#180) (built 2026-09-28)

- [ ] `infra/package.json` has `stack:init`, `clean` and `test`, with `rimraf`, `ignore` and `vitest` exact-pinned
- [ ] `registry-item.json` scaffolds `files/_gitignore` to `infra/.gitignore`, listing `.stage/`
- [ ] `stack:init`, then `preview`, run with no interactive prompt
- [ ] `pnpm --filter @repo/infra clean` removes `infra/.stage/`
- [ ] `pnpm deps:check`, `pnpm lint` and the module tests pass

### Phase 3: docs, live proof, release (#180)

Blocked by the `fix(template)` issue for a fresh base that builds.

- [ ] the `saasaloy-infra` skill covers assets-only services, the staging copy and why it exists, the `main` plus `assets` refusal, `stack:init`, `clean`, the token scope and the `@vX.Y.Z` pin form; its "only understands `vars` and `d1_databases`" line is updated
- [ ] the `CLOUDFLARE_API_TOKEN` text in `registry-item.json` matches the skill
- [ ] ADR 0021's References gain "Assets-only Workers: #180, plan 0067."
- [ ] a live deploy from `.dev/` serves the landing page, the 404 page with status 404 on an unknown path, and the immutable `Cache-Control` on `/_astro/*`
- [ ] `/wrangler.json`, `/.dev.vars`, `/.assetsignore` and `/_headers` each return 404
- [ ] the `admin` app returns `index.html` with status 200 on a deep route such as `/some/deep/route`
- [ ] `pulumi preview --diff` after one changed page shows a diff on that Worker; with no change it shows none
- [ ] the live deploy runs with a token holding only "Workers Scripts: Edit" (plus D1 edit when `api` is present)
- [ ] `pulumi destroy` removes both assets-only Workers
- [ ] the next CLI release carries the change

## Open questions

None. The grill on 2026-09-28 settled every branch. Two findings moved to their own issues (see the last two rows of the decision table).

## Non-goals

- Custom domains and zone routes
- CI deploys and a remote state backend
- Per-service Worker secret lists (`pushSecrets` still sends every non-credential key in `infra/.env` to every service that has a script)
- Server-rendered Astro pages, or any Worker with both `main` and `assets`
- `run_worker_first`, `assets.binding`, and other asset options no shipped service declares
- Module versioning
- The broken base build and the `pushSecrets` timing, each in its own issue
