// Test-only resolution shim, the same one `modules/payment-console` carries. Not shipped:
// the descriptor's `files` list names `files/bkash.ts` and `files/env.ts` and nothing else.
//
// `files/bkash.ts` reads `../provider`, which is `packages/payment/src/provider.ts` once
// the file is installed. In this repo the file sits one directory below
// `modules/payment-bkash/`, so `../provider` resolves here instead.
export * from "../payment/files/src/provider";
