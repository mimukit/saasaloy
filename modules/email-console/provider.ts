// Test-only resolution shim, the same one `modules/email-plunk` carries. Not shipped: the
// descriptor's `files` list never names this file.
//
// `files/console.ts` lands at `packages/email/src/providers/console.ts` in a generated
// project, where `../provider` is the capability's contract. In this repo the file sits one
// directory below `modules/email-console/`, so `../provider` resolves here instead.
// Re-exporting the real core from the sibling module lets `files/console.test.ts` load the
// provider in place, against the same code the project gets, with no copy and no fake.
export * from "../email/files/src/provider";
