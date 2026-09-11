// Test-only resolution shim, the same one `modules/kv-memory` carries. Not shipped: the
// descriptor's `files` list names `files/khudebarta.ts` and nothing else.
//
// `files/khudebarta.ts` lands at `packages/sms/src/providers/khudebarta.ts` in a generated
// project, where `../provider` is the capability's contract. In this repo the file sits one
// directory below `modules/sms-khudebarta/`, so `../provider` resolves here instead.
// Re-exporting the real core from the sibling module lets `files/khudebarta.test.ts` load the
// provider in place, against the same code the project gets, with no copy and no fake.
export * from "../sms/files/src/provider";
