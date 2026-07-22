// Shared helpers for clack terminal output, used by the commands' `note` boxes.

// pnpm (and our own picocolors output) embed SGR codes; strip them when measuring
// or when a block needs recoloring uniformly (embedded resets cancel a wrapper color).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// Hard-wrap text to the terminal width so a `note` box can't overflow the rail.
// clack's box adds a border + padding (~6 cols), so we wrap a bit narrower. Widths
// are measured on the ANSI-stripped text so colored words wrap by their visible
// length. Words longer than the width (URLs, hashes) are split so nothing runs off
// the edge — except words carrying ANSI codes, which a raw slice could cut mid-escape;
// those are left whole on their own line.
export function wrapForNote(text: string): string {
  const width = Math.max(24, (process.stdout.columns ?? 80) - 6);
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let current = "";
    for (const word of line.split(" ")) {
      let chunk = word;
      // Break a single over-long word across lines.
      while (stripAnsi(chunk).length > width && !chunk.includes("\u001b")) {
        if (current) {
          out.push(current);
          current = "";
        }
        out.push(chunk.slice(0, width));
        chunk = chunk.slice(width);
      }
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (stripAnsi(candidate).length > width) {
        out.push(current);
        current = chunk;
      } else {
        current = candidate;
      }
    }
    out.push(current);
  }
  return out.join("\n");
}
