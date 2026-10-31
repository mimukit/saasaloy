// Test-only resolution shim; see ./index.ts for why it exists. `files/console.ts` reads
// `../provider` for `SubscriptionError` and the contract types, which is the capability's
// `packages/subscription/src/provider.ts` once the file is installed.
export * from "../subscription/files/src/provider";
