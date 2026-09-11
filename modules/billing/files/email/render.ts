// Test-only resolution shim, the same one `modules/billing-console` carries. Not shipped:
// the descriptor's `files` list names the three templates in `./templates/` and nothing
// else.
//
// `files/email/templates/*.ts` land at `packages/email/src/templates/*.ts` in a generated
// project, where `../render` is the email capability's own renderer. In this repo they sit
// in `modules/billing/files/email/templates/`, so `../render` resolves here instead.
// Re-exporting the real renderer from `modules/email` lets `files/email/templates.test.ts`
// render the templates in place, against the same code the project gets.
export * from "../../../email/files/src/render";
