// Test-only resolution shim; see ./index.ts for why it exists. `files/console.ts` reads
// `../provider` for `BillingError` and the contract types, which is the capability's
// `packages/billing/src/provider.ts` once the file is installed.
export * from "../billing/files/src/provider";
