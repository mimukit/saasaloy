// Test-only resolution shim. Not shipped: the descriptor's `files` list names the files
// under `files/` that are not tests.
//
// A file under `files/` lands in `packages/ai/src/sdk/` in a generated project, where
// `../provider`, `../define` and `../usage` are the core's sources. In this repo the files
// sit one directory below `modules/ai-sdk/`, so those paths resolve to these shims instead.
export * from "../ai/files/src/provider";
