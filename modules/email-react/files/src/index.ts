export { defineReactTemplate } from "./define";
export type { ReactEmailDocument, ReactEmailTemplate } from "./define";

// Re-exported, not reimplemented. JSX escapes every interpolation, which stops markup —
// but a `javascript:` URL holds no markup to escape and would reach the inbox as a
// working link. Run any caller-supplied `href` through this, exactly as a tagged
// template does.
export { safeUrl } from "@repo/email";
