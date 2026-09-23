// Test-only resolution shim; see ./provider.ts. `files/sslcommerz.ts` reads `../define` for
// `findPlan`, which is `packages/billing/src/define.ts` once the file is installed.
export * from "../billing/files/src/define";
