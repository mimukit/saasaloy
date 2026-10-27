// Test-only resolution shim; see ./provider.ts. `files/bkash.ts` reads `../provider-env`,
// which is `packages/payment/src/provider-env.ts` in a generated project.
export * from "../payment/files/src/provider-env";
