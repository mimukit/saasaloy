// The `Update-Note:` commit footer (issue #298). A breaking commit either adds an update
// note under an `update-notes/` folder or carries `Update-Note: none (<reason>)`, and the
// release preflight prints that reason. Two places read the footer, so it is parsed here
// once: `release-preflight.ts` at release time, and `commitlint.config.js` at commit time,
// which registers `updateNoteReasonRule` as a local rule.
//
// The rule reads the raw message rather than commitlint's parsed footer. The
// conventional-commits parser only splits notes on `BREAKING CHANGE`, so an `Update-Note:`
// line lands in `footer` or `body` depending on what precedes it.
//
// Imports nothing. Node 24 strips the types, so commitlint loads it straight from the
// `.js` config; `pnpm typecheck` checks it via tsconfig.scripts.json.

const FOOTER = /^Update-Note:(.*)$/i;
const OPT_OUT = /^none[ \t]*\((.*)\)$/;

/** The value of each `Update-Note:` line, skipping git's `#` comment lines. */
export function updateNoteFooters(message: string): string[] {
  return message
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .flatMap((line) => {
      const value = FOOTER.exec(line.trimEnd())?.[1];
      return value === undefined ? [] : [value.trim()];
    });
}

/** The reason in a `none (<reason>)` value, or null when the value is malformed or blank. */
function optOutReason(value: string): string | null {
  const reason = OPT_OUT.exec(value)?.[1]?.trim() ?? "";
  return reason === "" ? null : reason;
}

/**
 * The reason from an `Update-Note: none (<reason>)` footer, or null when there is no such
 * footer or the reason is blank. A blank reason is no opt-out: the point of the footer is
 * that the maintainer reads why a breaking change needs no note.
 */
export function updateNoteOptOut(message: string): string | null {
  for (const value of updateNoteFooters(message)) {
    const reason = optOutReason(value);
    if (reason !== null) {
      return reason;
    }
  }
  return null;
}

/**
 * commitlint rule `update-note-reason`: every `Update-Note:` footer reads
 * `none (<non-empty reason>)`. A message without the footer passes.
 */
export function updateNoteReasonRule(parsed: {
  raw?: string | null;
}): [boolean, string?] {
  const bad = updateNoteFooters(parsed.raw ?? "").filter(
    (value) => optOutReason(value) === null
  );
  if (bad.length === 0) {
    return [true];
  }
  return [
    false,
    `Update-Note footer must read "Update-Note: none (<reason>)" with a non-empty reason, got "${bad[0] ?? ""}"`,
  ];
}
