// Test-only resolution shim. Not shipped: the descriptor's `files` list names
// `files/mock.ts` and nothing else.
//
// `files/mock.ts` lands at `packages/ai/src/providers/mock.ts` in a generated project,
// where `../provider` is the capability's contract. In this repo the file sits one
// directory below `modules/ai-mock/`, so `../provider` resolves here instead.
export * from "../ai/files/src/provider";
