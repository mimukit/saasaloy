// Test-only resolution shim; see ./index.ts. `files/console.ts` reads `../define` for
// `findPlan`, which is `packages/subscription/src/define.ts` once the file is installed.
export * from "../subscription/files/src/define";
