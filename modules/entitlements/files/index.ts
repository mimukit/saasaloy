// Test-only resolution shim, the same one `modules/billing-console` carries. NOT SHIPPED:
// this module's descriptor names `files/entitlements.ts` and `files/api/require-feature.ts`
// and nothing else, so nothing copies this file into a project.
//
// `files/entitlements.ts` lands at `packages/billing/src/entitlements.ts` in a generated
// project, where `./index` is the capability's own barrel. In this repo the file sits in
// `modules/entitlements/files/`, so `./index` resolves here instead. Re-exporting the real
// core from the sibling module lets `files/entitlements.test.ts` load the resolver in place,
// against the same code the project gets, with no copy and no fake.
//
// It has to live beside `entitlements.ts` rather than one directory up, because the shipped
// file's import is `./index`. That is the price of the file landing *inside* the capability
// package instead of next to it.
export * from "../../billing/files/src/index";
