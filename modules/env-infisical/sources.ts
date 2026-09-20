// Test-only resolution shim, the same one `modules/sms-khudebarta` carries. Not shipped:
// the descriptor's `files` list names `files/infisical.ts` and nothing else.
//
// `files/infisical.ts` lands at `packages/env/src/providers/infisical.ts` in a generated
// project, where `../sources` is the value-source contract. In this repo the file sits one
// directory below `modules/env-infisical/`, so `../sources` resolves here instead.
// Re-exporting the real core from the base template lets `files/infisical.test.ts` load
// the source in place, against the same code the project gets, with no copy and no fake.
export * from "../../packages/cli/templates/base/packages/env/src/sources";
