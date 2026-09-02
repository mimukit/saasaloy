import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

// The waitlist module's landing-page block. It follows the same rules as the base blocks
// in this folder — one file, one component export, its copy as in-file defaults — with
// two differences worth stating.
//
// First, the words stay here rather than in ../content/landing.ts, because that file
// belongs to the base and a module never edits a file it does not own.
//
// Second, and the important one: **this block knows nothing about the network.** It takes
// `onSubmit` and calls it. Where the address goes, which client sends it, and what a
// failure means are the app's business, so `packages/ui` imports no api package, no
// http client, and no env var. `apps/web/src/components/WaitlistForm.tsx` is the piece
// that supplies the function, and it is yours to edit.
//
// Nothing places this block for you either. The `saasaloy-waitlist` skill's Wire-up
// section carries the two lines that put it on a page.
//
// Styled from the same material as ./cta.tsx (the muted panel, the ring, the heading
// scale) but laid out in two columns rather than centred, so that placing it under the
// Cta block does not read as two centred panels stuttering.

/** What `onSubmit` answers with. A refusal carries the message the block shows. */
export type WaitlistResult = { ok: true } | { ok: false; message: string };

export type WaitlistSubmit = (email: string) => Promise<WaitlistResult>;

export interface WaitlistProps {
  /** Sends the address. Required — the block ships no default transport on purpose. */
  onSubmit: WaitlistSubmit;
  id?: string;
  title?: string;
  description?: string;
}

type Status = "idle" | "submitting" | "success" | "error";

const GENERIC_ERROR = "Something went wrong — try again.";

export function Waitlist({
  onSubmit,
  id = "waitlist",
  title = "Get early access",
  description = "Join the waitlist and we'll let you know the moment it's ready.",
}: WaitlistProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState(GENERIC_ERROR);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    // A thrown error is a caller that broke its own contract, and the person at the form
    // can do nothing with the detail — show the generic line rather than a stack.
    try {
      const result = await onSubmit(email);
      if (result.ok) {
        setStatus("success");
        return;
      }
      setMessage(result.message.length > 0 ? result.message : GENERIC_ERROR);
      setStatus("error");
    } catch {
      setMessage(GENERIC_ERROR);
      setStatus("error");
    }
  }

  return (
    <section
      id={id}
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20"
    >
      <div className="bg-muted ring-foreground/10 grid gap-8 rounded-2xl px-6 py-12 ring-1 sm:px-10 lg:grid-cols-2 lg:items-center lg:gap-12">
        <div className="flex flex-col gap-3">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {title}
          </h2>
          <p className="text-muted-foreground max-w-md text-base text-pretty">
            {description}
          </p>
        </div>
        {/* Success replaces the whole form in place — the confirmation lands exactly
            where the input was, so there is no lingering enabled form and no toast to
            chase. */}
        {status === "success" ? (
          <p
            role="status"
            className="border-border bg-background rounded-xl border px-4 py-3 text-sm font-medium text-pretty"
          >
            You’re on the list — we’ll be in touch.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              {/* The heading and the placeholder already say what the field is, so the
                  label is visually hidden rather than dropped — it still associates with
                  the input for screen readers and for clicking. */}
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
              <Button
                type="submit"
                size="lg"
                disabled={status === "submitting"}
              >
                {status === "submitting" ? "Joining…" : "Join the waitlist"}
              </Button>
            </div>
            {status === "error" && (
              <p role="alert" className="text-destructive text-sm">
                {message}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
