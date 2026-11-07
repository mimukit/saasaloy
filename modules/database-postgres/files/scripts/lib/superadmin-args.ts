// The flags of `pnpm db:prod:superadmin`, read without touching a database or the
// terminal, so the rules are testable on their own.

export interface SuperadminArgs {
  /** Trimmed and lowercased, as Better Auth stores and looks it up. */
  email: string;
  /** The display name for a new account. Absent means the email's local part. */
  name?: string;
  /** Keep the password on file rather than prompt for a new one. */
  keepPassword: boolean;
}

export const SUPERADMIN_USAGE =
  "Usage: pnpm db:prod:superadmin --email <address> [--name <display name>] [--keep-password]";

/** A loose shape check. Better Auth checks the address again at sign-in. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Read the superadmin script's flags. A leading `--`, which `pnpm run x -- --email a`
 * forwards as written, is skipped. A seed or placeholder address (`.test`, `.invalid`) is
 * refused, because nobody can receive mail there.
 */
export function parseSuperadminArgs(argv: readonly string[]): SuperadminArgs {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let email: string | undefined;
  let name: string | undefined;
  let keepPassword = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--keep-password") {
      keepPassword = true;
    } else if (flag === "--email" || flag === "--name") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} needs a value.\n${SUPERADMIN_USAGE}`);
      }
      index += 1;
      if (flag === "--email") {
        email = value;
      } else {
        name = value.trim();
      }
    } else {
      throw new Error(`Unknown argument ${String(flag)}.\n${SUPERADMIN_USAGE}`);
    }
  }
  if (email === undefined) {
    throw new Error(`--email is required.\n${SUPERADMIN_USAGE}`);
  }
  const normalized = email.trim().toLowerCase();
  if (!EMAIL.test(normalized)) {
    throw new Error(`${email} is not an email address.`);
  }
  if (normalized.endsWith(".test") || normalized.endsWith(".invalid")) {
    throw new Error(
      `${normalized} is a seed or placeholder address. Use a real one.`
    );
  }
  return {
    email: normalized,
    ...(name ? { name } : {}),
    keepPassword,
  };
}

/** The name a new account gets when `--name` is absent: the email's local part. */
export function defaultName(email: string): string {
  return email.split("@")[0] || email;
}
