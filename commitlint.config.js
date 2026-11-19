// Conventional Commits, plus one local rule. This repo's history is already
// `type(scope): subject` with free-form scopes, which the default config accepts
// as-is — nothing here needs a `scope-enum`, and adding one would start rejecting
// commits that were fine yesterday.
//
// `update-note-reason` rejects an `Update-Note:` footer unless it reads
// `none (<reason>)` with a non-empty reason. A breaking commit uses that footer to opt
// out of an update note, and the release preflight prints the reason (issue #298). The
// rule lives in `scripts/update-note-footer.ts`, which the preflight shares, and has its
// tests there.
//
// `update-note-for-sha` rejects an `Update-Note-For:` footer unless it names a full
// 40-character SHA. A later commit uses that footer to add the note a breaking commit
// missed (issue #358); the rule lives in the same file.
//
// Bypass for a genuine emergency: `git commit --no-verify`, or `HUSKY=0 git commit`
// to skip every hook at once (which is also how CI avoids installing them).
import {
  updateNoteForRule,
  updateNoteReasonRule,
} from "./scripts/update-note-footer.ts";

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "update-note-reason": updateNoteReasonRule,
        "update-note-for-sha": updateNoteForRule,
      },
    },
  ],
  rules: {
    "update-note-reason": [2, "always"],
    "update-note-for-sha": [2, "always"],
  },
};
