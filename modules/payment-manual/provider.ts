// Test-only resolution shim, the same one `modules/payment-console` carries. Not shipped:
// the descriptor's `files` list names `files/manual.ts` and nothing else.
//
// `files/manual.ts` reads `../provider`, which is `packages/payment/src/provider.ts` once
// the file is installed. In this repo the file sits one directory below
// `modules/payment-manual/`, so `../provider` resolves here instead.
export * from "../payment/files/src/provider";
