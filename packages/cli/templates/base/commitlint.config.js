// Conventional Commits (`feat:`, `fix(api):`, `chore(deps):` …), enforced by the
// `commit-msg` hook. Scopes are free-form — add a `scope-enum` rule here if you
// want to pin them down.
//
// Bypass for a genuine emergency: `git commit --no-verify`, or `HUSKY=0 git commit`
// to skip every hook at once (which is also how CI avoids installing them).
export default {
  extends: ["@commitlint/config-conventional"],
};
