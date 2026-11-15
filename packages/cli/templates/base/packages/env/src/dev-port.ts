// The dev port a dev config listens on: `DEV_PORT` from the service's `.env.local` when
// `pnpm dev:ports` wrote one, and the service's pinned port otherwise. A linked worktree
// gets its own block of ports this way, so two checkouts run `pnpm dev` at once.
//
// A bad value throws rather than falling back. A dev server that quietly takes the pinned
// port in a worktree collides with the main checkout, which is the fault this key exists
// to prevent.

/**
 * `value` as a port, or `fallback` when it is unset or blank. `file` is the file the
 * value came from, so the error names where to fix it.
 */
export function devPort(
  value: string | undefined,
  fallback: number,
  file: string
): number {
  const port = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `DEV_PORT is "${value}". It must be an integer from 1 to 65535. pnpm dev:ports writes it in ${file}.`
    );
  }
  return port;
}
