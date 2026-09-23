// Test-only resolution shim, the same one `modules/billing-console` carries. Not shipped:
// the descriptor's `files` list names `files/sslcommerz.ts` and nothing else.
//
// `files/sslcommerz.ts` lands at `packages/billing/src/providers/sslcommerz.ts` in a
// generated project, where `../provider` is the capability's contract file. In this repo the
// file sits one directory below `modules/billing-sslcommerz/`, so `../provider` resolves
// here instead, and the re-export points it at the real core.
export * from "../billing/files/src/provider";
