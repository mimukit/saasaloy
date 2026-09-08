// Test-only resolution shim; see ./provider.ts for why it exists. `files/memory.test.ts`
// reads `../index` for `defineKv` and `definePolicy`, so a test can drive the provider
// through the real capability core rather than calling its four methods by hand.
export * from "../kv/files/src/index";
