// Test-only resolution shim; see ./index.ts for why it exists. `files/memory.ts` reads
// `../provider` for `QueueError` and the contract types, which is the capability's
// `packages/queue/src/provider.ts` once the file is installed.
export * from "../queue/files/src/provider";
