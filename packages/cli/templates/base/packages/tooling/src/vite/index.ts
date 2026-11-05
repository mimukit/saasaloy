// `@repo/tooling/vite`: the dev server plugins the apps share. Both are `apply: "serve"`,
// so a build never runs them.
export { devGzip } from "./dev-gzip.ts";
export { restartOnLockfile } from "./restart-on-lockfile.ts";
