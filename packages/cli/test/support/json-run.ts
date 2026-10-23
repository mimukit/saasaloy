import { stripAnsi } from "../../src/lib/tui.js";

// Run a command in-process with stdout and stderr captured apart, for the `--json` tests
// (#223). stdout is parsed as JSON, so a TUI line that leaked onto it fails the parse:
// that failure is the test that the TUI went to stderr.

export interface JsonRun {
  code: number;
  /** The one document stdout carried. */
  doc: Record<string, unknown>;
  /** stderr with the ANSI codes stripped: the TUI. */
  err: string;
}

export async function runJson(
  command: (argv: string[]) => Promise<number>,
  argv: string[]
): Promise<JsonRun> {
  const out: string[] = [];
  const err: string[] = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    err.push(stripAnsi(String(chunk)));
    return true;
  };
  let code: number;
  try {
    code = await command(argv);
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
  return {
    code,
    doc: JSON.parse(out.join("")) as Record<string, unknown>,
    err: err.join(""),
  };
}
