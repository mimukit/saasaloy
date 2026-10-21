// Test-only resolution shim; see ./provider.ts. `files/console.test.ts` reads `../index`
// for the real core, which is `packages/payment/src/index.ts` in a generated project.
export * from "../payment/files/src/index";
