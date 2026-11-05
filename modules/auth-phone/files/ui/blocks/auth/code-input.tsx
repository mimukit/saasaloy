import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";

import { AuthAlert, AuthCard } from "@repo/ui/blocks/auth/auth-card";
import { Button } from "@repo/ui/components/shell/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";

// The code step of a phone sign-up and of a reset. `auth-phone` ships it into `@repo/ui`
// when `shell` is installed. The card holds the code field and the resend countdown, a
// clock being local state a block may keep. It checks only the length: the app checks the
// code in `onSubmit` and returns a message when the code is wrong.
//
// One field, not a box per digit. The shell set has no OTP primitive, and a single
// numeric field with `autocomplete="one-time-code"` is the one the phone keyboard fills
// from the SMS. The wide letter spacing makes the digits read as a code.

export function CodeInputCard({
  sentTo,
  length,
  resendSeconds,
  onSubmit,
  onResend,
  onBack,
  title = "Enter the code",
  submitLabel = "Continue",
}: {
  /** Where the code went, as the screen shows it, such as `+1 202 555 0150`. */
  sentTo: string;
  /** Digits in the code. The `auth-phone` config section's `codeLength`. */
  length: number;
  /** The wait before "Send a new code", in seconds. The section's `resendSeconds`. */
  resendSeconds: number;
  /** Called with the code. Resolve to a message to show it, or to `undefined`. */
  onSubmit: (code: string) => Promise<string | undefined>;
  /** Send a new code. Resolve to a message when it did not go, and the clock stays at 0. */
  onResend: () => Promise<string | undefined>;
  /** Back to the number step. */
  onBack: () => void;
  title?: string;
  submitLabel?: string;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  // The message for the last code checked or the last resend. An edit hides it.
  const [answer, setAnswer] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [remaining, setRemaining] = useState(resendSeconds);

  // One tick a second until the clock reaches 0. The effect re-arms on each tick, so it
  // holds no stale `remaining`. At 0 no timer is set, and clearing an unset one is a no-op.
  useEffect(() => {
    const timer =
      remaining > 0
        ? window.setTimeout(() => {
            setRemaining((previous) => previous - 1);
          }, 1000)
        : undefined;
    return () => {
      window.clearTimeout(timer);
    };
  }, [remaining]);

  const message = incomplete ? `Enter all ${String(length)} digits.` : answer;

  async function check(value: string) {
    setPending(true);
    let result: string | undefined;
    try {
      result = await onSubmit(value);
    } catch (error) {
      setPending(false);
      throw error;
    }
    setPending(false);
    setAnswer(result === undefined || result === "" ? null : result);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || resending) {
      return;
    }
    if (code.length < length) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    setAnswer(null);
    void check(code);
  }

  async function resend() {
    setResending(true);
    setAnswer(null);
    setIncomplete(false);
    let result: string | undefined;
    try {
      result = await onResend();
    } catch (error) {
      setResending(false);
      throw error;
    }
    setResending(false);
    if (result === undefined || result === "") {
      setCode("");
      setRemaining(resendSeconds);
    } else {
      setAnswer(result);
    }
  }

  return (
    <AuthCard
      title={title}
      description={`We sent a ${String(length)}-digit code by SMS to ${sentTo}.`}
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="mt-6 flex flex-col gap-4"
      >
        <Field>
          <FieldLabel>Code</FieldLabel>
          <Input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={length}
            size="lg"
            autoFocus
            value={code}
            aria-invalid={message === null ? undefined : true}
            onChange={(event) => {
              setCode(
                event.target.value.replaceAll(/\D/g, "").slice(0, length)
              );
              setIncomplete(false);
              setAnswer(null);
            }}
            className="font-mono text-lg tracking-[0.5em] tabular-nums sm:text-lg"
          />
          <FieldDescription aria-live="polite">
            {remaining > 0 ? (
              `You can ask for a new code in ${String(remaining)} s.`
            ) : (
              <button
                type="button"
                onClick={() => {
                  void resend();
                }}
                disabled={resending}
                className="text-foreground focus-visible:ring-ring rounded-sm font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 disabled:opacity-64"
              >
                {resending ? "Sending a new code" : "Send a new code"}
              </button>
            )}
          </FieldDescription>
        </Field>
        <AuthAlert error={message} />
        <Button type="submit" size="lg" loading={pending} className="mt-1">
          {submitLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={pending}
        >
          Change number
        </Button>
      </form>
    </AuthCard>
  );
}
