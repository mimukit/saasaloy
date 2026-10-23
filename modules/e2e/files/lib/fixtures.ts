// The rows a spec writes, and how it keeps them apart from the last run's.
//
// The rule: a spec that writes a row writes a row nothing else will ever write. There is no
// cleanup step, and that is deliberate. A teardown that deletes rows does not run when a
// run crashes, so the next run starts poisoned — the failure a cleanup was supposed to
// prevent, arriving a day later and looking like a real bug. A unique row cannot collide
// with anything, crash or no crash.
//
// The signed-in account is the one exception and stays fixed (`SEED_ADMIN` in
// ./project.ts). It is a seed row: `pnpm db:seed` upserts it before every run, so it is put
// back to its slice values rather than written by a spec.
//
// `.test` is the reserved TLD from RFC 2606, so none of these addresses can reach a real
// mailbox even if a module later wires email in.

/** An address no other run has used, for a spec that inserts a row keyed by email. */
export function uniqueEmail(prefix: string): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `e2e-${prefix}-${stamp}@example.test`;
}
