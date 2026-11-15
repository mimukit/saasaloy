// Test-only resolution shim; see ./render.ts for why it exists. The templates read
// `../provider` for the `EmailTemplate` type, which is `packages/email/src/provider.ts`
// once they are installed.
export * from "../../../email/files/src/provider";
