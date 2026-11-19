// Which lines of a Markdown page sit in a fenced code block, by the CommonMark rule: a fence
// opens with three or more backticks or tildes, and only a line of the same character, at
// least as long and with nothing after it, closes it. Any indent counts, so a fence inside a
// nested list item is found. So a ```` fence that shows a ``` block
// stays open over it. Import-free, so the site, its remark plugins and the root scripts
// (scripts/docs-generate.ts) share one rule.

/**
 * A reader that takes a page's lines in order and returns true for each line that is a fence
 * or lies inside one. Make a new reader for each page.
 */
export function fenceReader(): (line: string) => boolean {
  let open: { char: string; size: number } | undefined;
  return (line) => {
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open === undefined) {
      if (match === null) {
        return false;
      }
      const [, fence = "", rest = ""] = match;
      // A backtick fence's info string may not hold a backtick.
      if (fence.startsWith("`") && rest.includes("`")) {
        return false;
      }
      open = { char: fence.charAt(0), size: fence.length };
      return true;
    }
    if (match !== null) {
      const [, fence = "", rest = ""] = match;
      if (
        fence.charAt(0) === open.char &&
        fence.length >= open.size &&
        rest.trim() === ""
      ) {
        open = undefined;
      }
    }
    return true;
  };
}
