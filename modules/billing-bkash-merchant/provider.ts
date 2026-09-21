// Test-only resolution shim, the same one `modules/billing-sslcommerz` carries. Not shipped:
// the descriptor's `files` list names `files/bkash-merchant.ts` and nothing else.
//
// `files/bkash-merchant.ts` lands at `packages/billing/src/providers/bkash-merchant.ts` in a
// generated project, where `../provider` is the capability's contract file. In this repo the
// file sits one directory below `modules/billing-bkash-merchant/`, so `../provider` resolves
// here instead, and the re-export points it at the real core.
export * from "../billing/files/src/provider";
