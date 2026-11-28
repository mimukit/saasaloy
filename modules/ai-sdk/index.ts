// Test-only resolution shim; see ./provider.ts for why it exists. The driver tests read
// `../index` for `defineAi`, so they drive the real core.
export * from "../ai/files/src/index";
