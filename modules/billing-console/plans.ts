// Test-only resolution shim; see ./index.ts. `files/console.ts` reads `../plans` for the
// project's plan table, which is `packages/billing/src/plans.ts` once the file is installed.
export * from "../billing/files/src/plans";
