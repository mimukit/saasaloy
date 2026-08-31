import pc from "picocolors";

// One shape for `saasaloy <command> --help`. Before #98 the flag reached a command's
// argument parser, which did not know it, so `saasaloy add --help` died with "Unknown
// argument(s): --help" — the one message a person asking for help cannot use. Every
// command now answers it the same way, and every command rejects a flag it does not
// know rather than ignoring it.

export interface CommandHelp {
  /** The command's own name, e.g. `add`. */
  name: string;
  /** The one-line description, taken from the command registry. */
  describe: string;
  /** The usage line, without the leading `saasaloy`. */
  usage: string;
  /** Flag → what it does. Rendered in declaration order. */
  flags: Record<string, string>;
}

/** The flags every command accepts, listed after its own. */
export const COMMON_FLAGS: Record<string, string> = {
  "-h, --help": "show this help",
};

export function printCommandHelp(help: CommandHelp): void {
  console.log(
    `${pc.bold(`saasaloy ${help.name}`)} ${pc.dim(`— ${help.describe}`)}\n`
  );
  console.log(`${pc.bold("Usage:")} ${help.usage}\n`);
  console.log(pc.bold("Flags:"));
  const flags = { ...help.flags, ...COMMON_FLAGS };
  const width = Math.max(...Object.keys(flags).map((flag) => flag.length));
  for (const [flag, describe] of Object.entries(flags)) {
    console.log(`  ${pc.cyan(flag.padEnd(width))}  ${pc.dim(describe)}`);
  }
}

/** True when the user asked for a command's help rather than for the command. */
export function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}
