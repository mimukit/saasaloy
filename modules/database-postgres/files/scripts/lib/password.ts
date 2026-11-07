import { randomBytes, scrypt } from "node:crypto";

// Better Auth's password hash, reproduced so `pnpm db:prod:superadmin` can write a
// credential account without loading Better Auth. Better Auth stores `<salt>:<key>` in hex:
// a 16-byte random salt, used as its hex string, and a 64-byte scrypt key with N=16384,
// r=16, p=1 over the NFKC form of the password.
//
// `../../src/seed/slices/accounts.ts` stores the dev password in the same form, and the
// repo's tests check this file against that hash, which Better Auth signs in with.
// Re-check both on a `better-auth` version bump.

const SCRYPT = { N: 16_384, r: 16, p: 1, dkLen: 64 } as const;

/**
 * The shortest password a superadmin may have. It matches `MIN_PASSWORD_LENGTH` in
 * `packages/auth/src/auth.ts`, which Better Auth applies on sign-up, reset and change.
 * That file loads `cloudflare:workers`, so this script cannot import it: change both.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** Better Auth's default `maxPasswordLength`. A longer one cannot sign in. */
export const MAX_PASSWORD_LENGTH = 128;

async function deriveKey(password: string, salt: string): Promise<Buffer> {
  // `scrypt` reports through a callback, not a promise, so this wraps it in one.
  // oxlint-disable-next-line promise/avoid-new
  return await new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      SCRYPT.dkLen,
      {
        N: SCRYPT.N,
        r: SCRYPT.r,
        p: SCRYPT.p,
        maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
      },
      (error, key) => {
        if (error) {
          reject(error);
        } else {
          resolve(key);
        }
      }
    );
  });
}

/** Hash `password` the way Better Auth's email-and-password sign-in expects it. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt);
  return `${salt}:${key.toString("hex")}`;
}

/** True when `password` matches a `<salt>:<key>` hash. */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) {
    throw new Error("Not a Better Auth password hash.");
  }
  const derived = await deriveKey(password, salt);
  return derived.toString("hex") === key;
}

/** Why `password` cannot be a superadmin's, or `undefined` when it can. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `The password needs at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `The password may have at most ${String(MAX_PASSWORD_LENGTH)} characters; Better Auth refuses a longer one at sign-in.`;
  }
  if (password.trim() !== password) {
    return "The password starts or ends with a space. Type it again without one.";
  }
  return undefined;
}
