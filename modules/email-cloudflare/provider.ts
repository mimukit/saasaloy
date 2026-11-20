// Test-only resolution shim, the same one `modules/sms-khudebarta` carries. Not shipped: the
// descriptor's `files` list never names this file.
//
// `files/cloudflare.ts` lands at `packages/email/src/providers/cloudflare.ts` in a generated project,
// where `../provider` is the capability's contract. In this repo the file sits one directory
// below `modules/email-cloudflare/`, so `../provider` resolves here instead. Re-exporting the real core
// from the sibling module lets `files/cloudflare.test.ts` load the provider in place, against the
// same code the project gets, with no copy and no fake.
export * from "../email/files/src/provider";
