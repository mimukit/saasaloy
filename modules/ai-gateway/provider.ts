// Test-only resolution shim. Not shipped: the descriptor's `files` list names
// `files/gateway.ts` and `files/env.ts` and nothing else.
//
// `files/gateway.ts` lands at `packages/ai/src/providers/gateway.ts` in a generated
// project, where `../provider` is the capability's contract. In this repo the file sits
// one directory below `modules/ai-gateway/`, so `../provider` resolves here instead.
export * from "../ai/files/src/provider";
