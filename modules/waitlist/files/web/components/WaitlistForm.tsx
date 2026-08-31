import { hc } from "hono/client";
import { useState } from "react";
import type { FormEvent } from "react";

import type { AppType } from "@repo/api/client";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

// `lucide-react` is a dependency of @repo/ui, not of apps/web, so a module-dropped file
// here cannot import an icon directly.

// Falls back to the api Worker's pinned local dev port (:4000, fixed in both
// vite.config.ts and wrangler.jsonc) when PUBLIC_API_URL isn't set — see the
// saasaloy-waitlist skill for the production value.
const API_BASE = import.meta.env.PUBLIC_API_URL ?? "http://localhost:4000";

// The consumer's own three-line client. `AppType` is api's route chain, so `api.waitlist`
// and the body it takes come from the route file itself — rename the path or change the
// schema and this call stops typechecking. `@repo/api/client` is a types-only export, so
// nothing of the Worker reaches this bundle.
const api = hc<AppType>(API_BASE);

type Status = "idle" | "submitting" | "success" | "error";

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

const GENERIC_ERROR = "Something went wrong — try again.";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState(GENERIC_ERROR);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    try {
      // 201 on success, 400 with `{ error: { code, message } }` when the address is
      // rejected. The route builds that envelope on purpose, so read it: telling someone
      // their address is malformed is worth more than "something went wrong" (#98).
      const res = await api.waitlist.$post({ json: { email } });
      if (res.ok) {
        setStatus("success");
        return;
      }
      // A refusal that carries no envelope — a proxy's 502, an empty body — falls back
      // to the generic line rather than showing the user a parse failure.
      const body: unknown = await res.json().catch(() => null);
      setMessage(envelopeMessage(body) ?? GENERIC_ERROR);
      setStatus("error");
    } catch {
      setMessage(GENERIC_ERROR);
      setStatus("error");
    }
  }

  // Success replaces the whole form in place — the confirmation lands exactly where the
  // input was, so there is no lingering enabled form and no toast to chase.
  if (status === "success") {
    return (
      <p
        role="status"
        className="border-border bg-background rounded-xl border px-4 py-3 text-sm font-medium text-pretty"
      >
        You’re on the list — we’ll be in touch.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        {/* The section heading and the placeholder already say what the field is, so the
            label is visually hidden rather than dropped — it still associates with the
            input for screen readers and for clicking. */}
        <Label htmlFor="waitlist-email" className="sr-only">
          Email
        </Label>
        <Input
          id="waitlist-email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          disabled={status === "submitting"}
          onChange={(event) => setEmail(event.target.value)}
          className="h-9 flex-1"
        />
        <Button type="submit" size="lg" disabled={status === "submitting"}>
          {status === "submitting" ? "Joining…" : "Join the waitlist"}
        </Button>
      </div>
      {status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
