import type { PaymentEnv } from "./provider";

// The provider env port (ADR 0057). A queue job is called as `(payload, ctx)` and gets no
// `env`, so a provider that owns a scheduled job (`payment-bkash`'s token refresh) reads the
// Worker environment back out of here. `apps/api/src/payment-store.ts` sets it once, at
// module load.
//
// The value is typed `PaymentEnv`, which is opaque by construction: the core carries the
// environment and reads nothing out of it. A provider's credentials stay keys the core
// never learns.

let providerEnv: PaymentEnv | undefined;

/** Register the Worker environment for provider-owned jobs. Called once, at module load. */
export function setPaymentProviderEnv(env: PaymentEnv): void {
  providerEnv = env;
}

/**
 * The environment `setPaymentProviderEnv` registered. Throws when nothing has: answering
 * `{}` would show a job every key unset and report a missing registration as a missing
 * secret.
 */
export function paymentProviderEnv(): PaymentEnv {
  if (!providerEnv) {
    throw new Error(
      "No payment provider env is registered. apps/api/src/payment-store.ts calls setPaymentProviderEnv(env) at module load; import it before a provider-owned job runs."
    );
  }
  return providerEnv;
}
