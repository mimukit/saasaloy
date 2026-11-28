// Test-only resolution shim; see ./provider.ts for why it exists. `files/mock.test.ts`
// reads `../index` for `defineAi`, so a test can drive the provider through the real core.
export * from "../ai/files/src/index";
