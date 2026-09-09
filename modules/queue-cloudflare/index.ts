// Test-only resolution shim. Not shipped: the descriptor's `files` list names
// `files/cloudflare.ts` and nothing else.
//
// `files/cloudflare.ts` lands at `packages/queue/src/providers/cloudflare.ts` in a
// generated project, where `../index` is the capability's barrel. In this repo the file
// sits one directory below `modules/queue-cloudflare/`, so `../index` resolves here
// instead. Re-exporting the real core from the sibling module lets
// `files/cloudflare.test.ts` load the provider in place, against the same code the
// project gets, with no copy and no fake.
export * from "../queue/files/src/index";
