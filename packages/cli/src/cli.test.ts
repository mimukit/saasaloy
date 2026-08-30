import { afterEach, describe, expect, it } from "vitest";
import type { SelectPrompt } from "./cli.js";
import { main, printHelp } from "./cli.js";
import type { Command, CommandRegistry } from "./commands/index.js";
import { COMMANDS } from "./commands/index.js";

// Dispatch is exercised through the injected seam (`main(argv, deps)`) rather than a
// module mock — the package mocks nothing anywhere else, and a parameter already gives
// us the registry and the prompt.

const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;

function setTTY(value: boolean): void {
  process.stdin.isTTY = value;
  process.stdout.isTTY = value;
}

interface Capture {
  out: string[];
  err: string[];
  restore: () => void;
}

// console.log/error carry the help text; clack's `cancel` writes straight to the
// stream, so that is swallowed too rather than painted across the test report.
function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  };
  process.stdout.write = () => true;
  return {
    out,
    err,
    restore() {
      console.log = originalLog;
      console.error = originalError;
      process.stdout.write = originalWrite;
    },
  };
}

interface Recorded {
  command: Command;
  calls: string[][];
}

function recordCommand(description: string, code = 0): Recorded {
  const calls: string[][] = [];
  return {
    calls,
    command: {
      describe: description,
      run(argv: string[]) {
        calls.push(argv);
        return code;
      },
    },
  };
}

type SelectArgs = Parameters<SelectPrompt>[0];

interface RecordedSelect {
  select: SelectPrompt;
  calls: SelectArgs[];
}

function recordSelect(result: string | symbol): RecordedSelect {
  const calls: SelectArgs[] = [];
  return {
    calls,
    select(opts) {
      calls.push(opts);
      return Promise.resolve(result);
    },
  };
}

// The real clack cancel symbol is module-private, so tests pair their own symbol with
// an `isCancel` that recognises it — the same shape `@clack/prompts` exports.
const CANCELLED = Symbol("test:cancel");
const isCancel = (value: unknown): value is symbol => typeof value === "symbol";

const init = recordCommand("scaffold a project", 0);
const add = recordCommand("apply a module", 7);
const registry: CommandRegistry = { init: init.command, add: add.command };

afterEach(() => {
  process.stdin.isTTY = ORIGINAL_STDIN_TTY;
  process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
  init.calls.length = 0;
  add.calls.length = 0;
});

describe(printHelp, () => {
  it("lists every command in the registry it is given", () => {
    const captured = capture();
    try {
      printHelp(registry);
    } finally {
      captured.restore();
    }
    const text = captured.out.join("\n");
    for (const [name, command] of Object.entries(registry)) {
      expect(text).toContain(name);
      expect(text).toContain(command.describe);
    }
  });

  it("renders the real registry, so a new command needs no second list", () => {
    const captured = capture();
    try {
      printHelp(COMMANDS);
    } finally {
      captured.restore();
    }
    const text = captured.out.join("\n");
    for (const name of Object.keys(COMMANDS)) {
      expect(text).toContain(name);
    }
  });
});

describe("main — explicit help", () => {
  it.each(["--help", "-h", "help"])(
    "prints help and exits 0 for %s, even on a TTY",
    async (flag) => {
      setTTY(true);
      const picker = recordSelect("init");
      const captured = capture();
      let code: number;
      try {
        code = await main([flag], {
          registry,
          select: picker.select,
          isCancel,
        });
      } finally {
        captured.restore();
      }
      expect(code).toBe(0);
      expect(picker.calls).toHaveLength(0);
      expect(captured.out.join("\n")).toContain("Usage:");
      expect(init.calls).toHaveLength(0);
    }
  );
});

describe("main — dispatch", () => {
  it("runs a known command with the remaining argv and returns its code", async () => {
    const captured = capture();
    let code: number;
    try {
      code = await main(["add", "waitlist", "--dry-run"], { registry });
    } finally {
      captured.restore();
    }
    expect(code).toBe(7);
    expect(add.calls).toStrictEqual([["waitlist", "--dry-run"]]);
  });

  it("errors, prints help and exits 1 on an unknown command — on a TTY too", async () => {
    setTTY(true);
    const picker = recordSelect("init");
    const captured = capture();
    let code: number;
    try {
      code = await main(["nope"], {
        registry,
        select: picker.select,
        isCancel,
      });
    } finally {
      captured.restore();
    }
    expect(code).toBe(1);
    expect(captured.err.join("\n")).toContain("nope");
    expect(captured.out.join("\n")).toContain("Usage:");
    expect(picker.calls).toHaveLength(0);
  });

  // The registry is a plain object, so it inherits these from Object.prototype and each
  // one is truthy. Looked up without an own-key check they sail past the unknown-command
  // guard and blow up on `.run`, turning a typo into a stack trace.
  it.each([
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
  ])("treats the inherited property %s as an unknown command", async (name) => {
    const captured = capture();
    let code: number;
    try {
      code = await main([name], { registry });
    } finally {
      captured.restore();
    }
    expect(code).toBe(1);
    expect(captured.err.join("\n")).toContain(name);
    expect(captured.out.join("\n")).toContain("Usage:");
    expect(init.calls).toHaveLength(0);
    expect(add.calls).toHaveLength(0);
  });
});

describe("main — bare invocation without a TTY", () => {
  it("prints exactly the help output and exits 0, never opening the picker", async () => {
    setTTY(false);
    const picker = recordSelect("init");

    const expected = capture();
    try {
      printHelp(registry);
    } finally {
      expected.restore();
    }

    const captured = capture();
    let code: number;
    try {
      code = await main([], { registry, select: picker.select, isCancel });
    } finally {
      captured.restore();
    }

    expect(code).toBe(0);
    expect(captured.out).toStrictEqual(expected.out);
    expect(picker.calls).toHaveLength(0);
    expect(init.calls).toHaveLength(0);
  });

  it("falls back when only one of the two streams is a TTY", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const picker = recordSelect("init");
    const captured = capture();
    let code: number;
    try {
      code = await main([], { registry, select: picker.select, isCancel });
    } finally {
      captured.restore();
    }
    expect(code).toBe(0);
    expect(picker.calls).toHaveLength(0);
  });
});

describe("main — bare invocation on a TTY", () => {
  it("offers one option per registry entry, in registry order, hinted by its describe", async () => {
    setTTY(true);
    const picker = recordSelect("init");
    const captured = capture();
    try {
      await main([], { registry, select: picker.select, isCancel });
    } finally {
      captured.restore();
    }
    expect(picker.calls).toHaveLength(1);
    expect(picker.calls[0]?.options).toStrictEqual(
      Object.keys(registry).map((name) => ({
        value: name,
        label: name,
        hint: registry[name]?.describe,
      }))
    );
  });

  it("runs the picked command with no argv and returns its code", async () => {
    setTTY(true);
    const picker = recordSelect("add");
    const captured = capture();
    let code: number;
    try {
      code = await main([], { registry, select: picker.select, isCancel });
    } finally {
      captured.restore();
    }
    expect(code).toBe(7);
    expect(add.calls).toStrictEqual([[]]);
  });

  it("prints no help above the picker — the option hints already carry it", async () => {
    setTTY(true);
    const picker = recordSelect("init");
    const captured = capture();
    try {
      await main([], { registry, select: picker.select, isCancel });
    } finally {
      captured.restore();
    }
    expect(captured.out.join("\n")).not.toContain("Usage:");
  });

  it("exits 1 without a stack trace when the picker is cancelled", async () => {
    setTTY(true);
    const picker = recordSelect(CANCELLED);
    const captured = capture();
    let code: number;
    try {
      code = await main([], { registry, select: picker.select, isCancel });
    } finally {
      captured.restore();
    }
    expect(code).toBe(1);
    expect(init.calls).toHaveLength(0);
    expect(add.calls).toHaveLength(0);
  });
});
