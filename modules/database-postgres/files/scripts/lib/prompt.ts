// Read a secret from the terminal without echoing it, or the first line of stdin when stdin
// is not a terminal (a password manager piping it in). Nothing here writes the value
// anywhere: the caller hashes it and drops it.

/** The first line of a piped stdin. */
async function firstLine(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
    const end = text.indexOf("\n");
    if (end !== -1) {
      return text.slice(0, end).replace(/\r$/, "");
    }
  }
  return text.replace(/\r?\n?$/, "");
}

/** One line typed at the terminal, echoed as nothing. Ctrl-C aborts. */
async function hiddenLine(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf-8");
  try {
    // A keypress stream, not a promise, so this wraps it in one.
    // oxlint-disable-next-line promise/avoid-new
    return await new Promise<string>((resolve, reject) => {
      let value = "";
      const onData = (chunk: string): void => {
        for (const char of chunk) {
          if (char === "\r" || char === "\n") {
            stdin.off("data", onData);
            stdout.write("\n");
            resolve(value);
            return;
          }
          if (char === "\u0003") {
            stdin.off("data", onData);
            stdout.write("\n");
            reject(new Error("Cancelled. Nothing was written."));
            return;
          }
          if (char === "\u007F" || char === "\b") {
            value = value.slice(0, -1);
          } else {
            value += char;
          }
        }
      };
      stdin.on("data", onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

/**
 * A new password: typed twice at a terminal and compared, or read once from a pipe.
 * Throws when the two entries differ.
 */
export async function readNewPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return await firstLine();
  }
  const first = await hiddenLine("New password: ");
  const second = await hiddenLine("Type it again: ");
  if (first !== second) {
    throw new Error("The two passwords differ. Nothing was written.");
  }
  return first;
}
