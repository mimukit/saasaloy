// Test-only resolution shim, the same one `modules/billing-sslcommerz` carries. Not shipped:
// the descriptor's `files` list names `files/bkash-personal.ts` and nothing else.
//
// `files/bkash-personal.ts` lands at `packages/billing/src/providers/bkash-personal.ts` in a
// generated project, where `../provider` is the capability's contract file. In this repo the
// file sits one directory below `modules/billing-bkash-personal/`, so `../provider` resolves
// here instead, and the re-export points it at the real core.
export * from "../billing/files/src/provider";
