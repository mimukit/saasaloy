// Test-only resolution shim; see ./provider.ts. `files/bkash-merchant.ts` reads `../config`
// for `billingProviderEnv`, the provider env port the token job reaches its credentials
// through (ADR 0040). That file is `packages/billing/src/config.ts` once installed.
export * from "../billing/files/src/config";
