// Test-only resolution shim. Not shipped: the descriptor's `files` list names
// `files/upstash.ts` and nothing else.
//
// `files/upstash.ts` lands at `packages/kv/src/providers/upstash.ts` in a generated
// project, where `../provider` is the capability's contract. In this repo the file sits
// one directory below `modules/kv-upstash/`, so `../provider` resolves here instead.
// Re-exporting the real core from the sibling module lets `files/upstash.test.ts` load
// the provider in place, against the same code the project gets, with no copy and no
// fake.
export * from "../kv/files/src/provider";
