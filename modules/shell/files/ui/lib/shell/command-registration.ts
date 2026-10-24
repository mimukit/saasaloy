import type { Command } from "./commands";

// The two pure rules behind `useCommands` in ./commands.ts. They sit in a file of their
// own, free of React, so `node --test` can load them; the type import above is erased.

/**
 * A string that changes when the shape of a command list changes, and only then: an id,
 * a title, a group, a shortcut, a keyword, or whether `when` or `active` is set. The
 * `run`, `when` and `active` closures change every render and are deliberately left
 * out, so a re-render does not re-register the list.
 */
export function commandsKey(commands: readonly Command[]): string {
  return JSON.stringify(
    commands.map((command) => [
      command.id,
      command.title,
      command.group,
      command.shortcut ?? null,
      command.keywords ?? [],
      command.when !== undefined,
      command.active !== undefined,
    ])
  );
}

/**
 * Copies of `commands` whose `run`, `when` and `active` call the command of the same id
 * in the list `read()` returns at call time. A registration made once then always runs the
 * latest closure. A command whose id has gone from the latest list does nothing, and its
 * `when` and `active` report `false`.
 */
export function delegateToLatest(
  commands: readonly Command[],
  read: () => readonly Command[]
): readonly Command[] {
  const find = (id: Command["id"]): Command | undefined =>
    read().find((candidate) => candidate.id === id);

  return commands.map((command) => ({
    ...command,
    run: (ctx) => {
      find(command.id)?.run(ctx);
    },
    when:
      command.when === undefined
        ? undefined
        : () => find(command.id)?.when?.() ?? false,
    active:
      command.active === undefined
        ? undefined
        : () => find(command.id)?.active?.() ?? false,
  }));
}
