// Repo-only shim. It is NOT in the descriptor's `files[]`, so `saasaloy add
// storage-memory` never copies it into a project.
//
// `files/memory.ts` ships to `@storage/providers/memory.ts`, where `../provider` is
// `packages/storage/src/provider.ts`. Inside this repo the same specifier lands here,
// so this file forwards it to the core the provider is written against. Without it,
// `files/memory.test.ts` could not import the provider at all.

export * from "../storage/files/src/provider.ts";
