// The public type surface of `@repo/api`, and the only thing a consumer imports.
//
// `package.json` maps `"./client"` to this file under a `types` condition alone, so
// there is no runtime entry to resolve and nothing here reaches a bundle. A consumer
// pairs it with `hc` from `hono/client`:
//
//   import { hc } from "hono/client";
//   import type { AppType } from "@repo/api/client";
//
//   const api = hc<AppType>(import.meta.env.PUBLIC_API_URL ?? "http://localhost:4000");
//   const res = await api.health.$get();
//
// Keep this file type-only. Exporting a value from here would put the Worker entry —
// its bindings, its middleware, its handlers — into every browser bundle that reads
// the type.
export type { AppType } from "./index";
