// Test-only resolution shim, the same one `modules/queue-memory` carries. Not shipped: the
// descriptor's `files` list names `files/console.ts` and nothing else.
//
// `files/console.ts` lands at `packages/subscription/src/providers/console.ts` in a generated
// project, where `../index` is the capability's barrel. In this repo the file sits one
// directory below `modules/subscription-console/`, so `../index` resolves here instead.
// Re-exporting the real core from the sibling module lets `files/console.test.ts` load the
// provider in place, against the same code the project gets, with no copy and no fake.
export * from "../subscription/files/src/index";
