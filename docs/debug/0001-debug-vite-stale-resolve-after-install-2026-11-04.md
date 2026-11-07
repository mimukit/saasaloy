# Debug: the dev server misses changes after an install

Issue: #307. Found 2026-11-04 with debugkit on a `.dev` scaffold (web and admin).

## Symptom

In PrimeShopr, a running dev server "missed changes in `packages/ui`" and agents restarted it about six times. The issue #105 session shows the real sequence: `packages/ui/src/lib/command/filter.ts` imported `@leeoniya/ufuzzy` before the package was installed, and the server kept the failure after the install.

## Cause

Vite 8's dev resolver caches a failed bare-import lookup, and only watcher events clear that cache. The watcher ignores `node_modules`, so an install never clears it. The import stays unresolved until the server restarts.

The line: `vite@8.3.1` `dist/node/chunks/node.js`, near line 28923. `oxcResolvePlugin` passes `viteResolvePlugin({ ..., disableCache: command === "serve" && server.watch === null })` and sets `perEnvironmentWatchChangeDuringDev = true`. The cache is on whenever the watcher is on.

The fault is general Vite 8 behaviour. `packages/ui` shows it most because the shared UI package gains new dependencies most often.

## Reproduction

On an admin SPA (`vite --port <free port>`):

1. Add `import uFuzzy from "@leeoniya/ufuzzy";` to `packages/ui/src/blocks/shell/page-skeleton.tsx` while the package is not installed. Load the admin page. The overlay shows `Failed to resolve import "@leeoniya/ufuzzy"`.
2. Run `pnpm --filter @repo/ui add @leeoniya/ufuzzy@1.0.19` while the server runs.
3. Reload three times. All three fail.

## Evidence

| Run | Result |
|---|---|
| Server started before the install | 3 of 3 reloads after the install fail |
| Restart after the install | 2 of 2 loads succeed |
| Uninstall, start, install again | 3 of 3 reloads fail |
| Same sequence with `server.watch: null` (cache off) | 3 of 3 reloads succeed, no restart |
| `touch` of the importer, an edit to the importer, a new file under `packages/ui/src/lib` | does not clear it |
| Control: `import dlv from "dlv"` in `apps/admin/src/main.tsx`, then `pnpm --filter @repo/admin add dlv` | 2 of 2 reloads fail |

## Eliminated

- `.tsx` edits in `packages/ui` reach SSR on the next request.
- optimizeDeps does not pre-bundle `@repo/ui` (no entry in `deps`, `deps_ssr` or `deps_astro`).
- The watcher sees `packages/ui`: the admin log shows `hmr update` and `page reload` for its files.
- Tailwind picks up a class in a new `packages/ui/src/blocks` file. The per-component `@source` list still misses a new file under `components/`; #306 owns that.
- A mid-session dependency re-bundle gives one request of "Invalid hook call", and the next request works with no restart.
- The inotify limit: `max_user_watches` and `max_user_instances` are both 1048576.

## Second finding, not explained

In apps/web, an edit to `packages/ui/src/styles/brand.css` does not reach the SSR-inlined `<style data-vite-dev-id=".../web.css">` (3 of 3). A `touch` of `web.css` refreshes it. The browser corrects it once the Vite client loads. The suspected mechanism is that the SSR environment does not invalidate `web.css` when a file it `@import`s changes; it is not toggled. It affects the first paint only, and #307 does not fix it.

## Fix in #307

`restartOnLockfile()` in `@repo/tooling/vite` watches `pnpm-lock.yaml` and calls `server.restart()` on a change. The template AGENTS.md and the `saasaloy-ui` skill tell an agent to restart the dev server after an install. `server.watch: null` is rejected because it removes HMR.

## Upstream report text

Not filed. For the owner to file on `vitejs/vite` if wanted:

> **Dev resolver keeps a failed bare import after the package is installed.** In Vite 8.3.1 dev, an import of a package that is not installed fails with `Failed to resolve import`. Installing the package while the server runs does not fix it: every reload still fails until a restart. The resolver cache is on when `server.watch` is set (`disableCache: command === "serve" && server.watch === null` in `oxcResolvePlugin`), and only watcher events clear it, but the watcher ignores `node_modules`. Steps: start `vite`, import an uninstalled package, `pnpm add` it, reload. Expected: the import resolves. With `server.watch: null` it does.
