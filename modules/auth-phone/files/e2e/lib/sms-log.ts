// The pure half of `./sms.ts`: it reads the messages the console SMS provider printed out
// of the api's log text. No file IO and no imports, so its node test needs no project.
//
// The provider (`packages/sms/src/providers/console.ts`, `SMS_PROVIDER=console`) prints
// each message as one framed block:
//
//   ───── sms (console provider) ─────
//   message-id: console-…
//   from:       Playground
//   to:         +12025550150
//   segments:   1
//
//   123456 is your Playground verification code. …
//   ──────────────────────────────────
//
// Change the two rule lines here together with that provider.

/** One message the console provider printed. */
export interface PrintedSms {
  /** Each recipient, as the provider printed it (E.164). */
  to: string[];
  body: string;
  /** Where the block starts in the log, in bytes. */
  offset: number;
}

const START = "───── sms (console provider) ─────";
const END = "──────────────────────────────────";
// Terminal colour codes a dev server may wrap its lines in.
// oxlint-disable-next-line no-control-regex -- matches the ESC byte of an ANSI colour code
const ANSI = /\u001B\[[0-9;]*m/g;

/** Every message in `log`, in the order the api sent them. */
export function parseSms(log: string): PrintedSms[] {
  const messages: PrintedSms[] = [];
  let from = log.indexOf(START);
  while (from !== -1) {
    const end = log.indexOf(END, from + START.length);
    if (end === -1) {
      break;
    }
    const lines = log
      .slice(from + START.length, end)
      .replaceAll(ANSI, "")
      .split(/\r?\n/)
      .map((line) => line.trim());
    const to = lines
      .find((line) => line.startsWith("to:"))
      ?.slice("to:".length)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    // The body follows the one blank line after the headers. The first line is the rest
    // of the start rule's own line, so the search starts after it.
    const blank = lines.indexOf("", 1);
    const body =
      blank === -1
        ? ""
        : lines
            .slice(blank + 1)
            .filter(Boolean)
            .join("\n");
    messages.push({
      to: to ?? [],
      body,
      offset: Buffer.byteLength(log.slice(0, from)),
    });
    from = log.indexOf(START, end + END.length);
  }
  return messages;
}

/** The code in a `verification-code` body (`<digits> is your …`), or `undefined`. */
export function codeIn(body: string): string | undefined {
  return /(?:^|\s)(\d{4,10}) is your\b/.exec(body)?.[1];
}

/**
 * The newest code sent to `phone` in a block that starts at or after `mark` bytes, or
 * `undefined` when there is none yet.
 */
export function latestCode(
  log: string,
  phone: string,
  mark: number
): string | undefined {
  return parseSms(log)
    .filter((sms) => sms.offset >= mark && sms.to.includes(phone))
    .map((sms) => codeIn(sms.body))
    .findLast((code) => code !== undefined);
}
