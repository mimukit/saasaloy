// The CLI's exit-code vocabulary, plus the error formatter every command's catch block
// shares. Before #98 every failure exited 1, so a script could not tell "saasaloy
// refused because the driver conflicts" from "the network broke mid-fetch". Three codes
// now carry that difference:
//
//   0 — the command did what it was asked, or the user answered "no" to a confirm.
//   1 — something failed or the user cancelled: a fetch died, a write threw, Ctrl-C.
//   2 — saasaloy refused by design: bad usage, a module conflict, an unmet requirement,
//       an invalid manifest, or a prompt with no terminal to answer it in.
//
// A wrapper script reads 2 as "the input is wrong, do not retry" and 1 as "transient,
// a retry may work". Nothing else may take on a third meaning; add a code here first.

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_REFUSED = 2;

/**
 * A failure saasaloy chose, thrown from a library that has no exit code to return.
 * `loadConfig` rejecting an invalid `saasaloy.json` is the shape: the command above it
 * catches, sees this type, and exits 2 instead of 1. A plain `Error` stays a 1.
 */
export class RefusalError extends Error {
  override readonly name = "RefusalError";
}

/** True when this error is a refusal saasaloy made, rather than a failure it hit. */
export function isRefusal(error: unknown): error is RefusalError {
  return error instanceof RefusalError;
}

/** `EXIT_REFUSED` for a refusal, `EXIT_FAILURE` for anything else. */
export function exitCodeFor(error: unknown): number {
  return isRefusal(error) ? EXIT_REFUSED : EXIT_FAILURE;
}

/**
 * Set this to any non-empty value to print the whole `cause` chain under the message.
 * `registry.ts` wraps a fetch failure with `{ cause: error }` and the top level printed
 * only `error.message`, so the underlying `ECONNREFUSED` never reached a bug report.
 */
export const DEBUG_ENV = "SAASALOY_DEBUG";

function isDebug(): boolean {
  return (process.env[DEBUG_ENV] ?? "") !== "";
}

// Guard against a cause cycle (`a.cause = b; b.cause = a`), which a hand-built error
// can produce and which would otherwise loop forever.
const MAX_CAUSE_DEPTH = 10;

/** Every `cause` under `error`, outermost first. Empty when nothing wrapped anything. */
export function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (chain.length < MAX_CAUSE_DEPTH) {
    if (!(current instanceof Error) || current.cause === undefined) {
      break;
    }
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    current = current.cause;
    chain.push(current);
  }
  return chain;
}

function describe(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  return String(value);
}

/**
 * The one-line message a command shows, plus the cause chain and stack when
 * `SAASALOY_DEBUG` is set. Every `catch` in the commands formats through this, so the
 * debug switch reaches all of them rather than the one that remembered it.
 */
export function formatFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!isDebug()) {
    return message;
  }
  const lines = [describe(error)];
  for (const [index, cause] of causeChain(error).entries()) {
    lines.push(`${"  ".repeat(index + 1)}caused by: ${describe(cause)}`);
  }
  return lines.join("\n");
}
