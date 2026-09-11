// Test-only resolution shim. Not shipped: the descriptor's `files` list names
// `files/cloudflare.ts` and nothing else.
//
// `files/cloudflare.ts` lands at `packages/kv/src/providers/cloudflare.ts` in a
// generated project, where `../provider` is the capability's contract. In this repo the
// file sits one directory below `modules/kv-cloudflare/`, so `../provider` resolves here
// instead. Re-exporting the real core from the sibling module lets
// `files/cloudflare.test.ts` load the provider in place, against the same code the
// project gets, with no copy and no fake.
export * from "../kv/files/src/provider";
