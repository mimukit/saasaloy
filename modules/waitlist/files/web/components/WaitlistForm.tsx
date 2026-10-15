import { hc } from "hono/client";

import type { AppType } from "@repo/api/client";
import { webEnv } from "@web/env";
import { Waitlist } from "@repo/ui/blocks/waitlist";
import type { WaitlistResult } from "@repo/ui/blocks/waitlist";

// The app's half of the waitlist. `@repo/ui/blocks/waitlist` renders the panel and owns
// the form's own state; it takes `onSubmit` and knows nothing else. Everything that ties
// the block to *this* project lives here: which api it talks to, which client sends the
// request, and how a refusal reads. That split is deliberate — `packages/ui` is the design
// layer, and a design layer that imports the api package drags the whole Worker source
// tree into its typecheck.
//
// This file is yours. Point it at a different endpoint, swap the client, add analytics on
// success — the block does not care.

// `PUBLIC_API_URL` comes from `apps/web/src/env.ts`, which validates it at build time.
// There is no fallback: an unset key fails the build naming the key, rather than shipping
// a bundle that calls http://localhost:4000 from production.
const API_BASE = webEnv().PUBLIC_API_URL;

// The consumer's own three-line client. `AppType` is api's route chain, so `api.waitlist`
// and the body it takes come from the route file itself — rename the path or change the
// schema and this call stops typechecking. `@repo/api/client` is a types-only export, so
// nothing of the Worker reaches this bundle.
const api = hc<AppType>(API_BASE);

const GENERIC_ERROR = "Something went wrong — try again.";

// What the api returns when it refuses: `{ error: { code, message } }`, built by
// `errorBody` in `@repo/validators/common`. The shape is checked structurally rather than
// with the zod schema, because `@repo/validators` is an api-side workspace and apps/web
// does not depend on it — importing the schema here would pull zod into the browser
// bundle to read one string.
function envelopeMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return undefined;
  }
  const { error } = body as { error: unknown };
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return undefined;
  }
  const { message } = error as { message: unknown };
  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}

async function submit(email: string): Promise<WaitlistResult> {
  // 201 on success, 400 with `{ error: { code, message } }` when the address is rejected.
  // The route builds that envelope on purpose, so read it: telling someone their address
  // is malformed is worth more than "something went wrong" (#98).
  const res = await api.waitlist.$post({ json: { email } });
  if (res.ok) {
    return { ok: true };
  }
  // A refusal that carries no envelope — a proxy's 502, an empty body — falls back to the
  // generic line rather than showing the user a parse failure.
  const body: unknown = await res.json().catch(() => null);
  return { ok: false, message: envelopeMessage(body) ?? GENERIC_ERROR };
}

export default function WaitlistForm() {
  return <Waitlist onSubmit={submit} />;
}
