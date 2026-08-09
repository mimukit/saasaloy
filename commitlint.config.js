// Conventional Commits, unmodified. This repo's history is already
// `type(scope): subject` with free-form scopes, which the default config accepts
// as-is — nothing here needs a `scope-enum`, and adding one would start rejecting
// commits that were fine yesterday.
//
// Bypass for a genuine emergency: `git commit --no-verify`, or `HUSKY=0 git commit`
// to skip every hook at once (which is also how CI avoids installing them).
export default {
  extends: ["@commitlint/config-conventional"],
};
