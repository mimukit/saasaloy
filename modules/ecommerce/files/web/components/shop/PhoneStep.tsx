import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@repo/ui/components/input-otp";
import { phoneText } from "@web/lib/shop";
import {
  answerText,
  checkCode,
  phoneRules,
  resetPassword,
  sendCode,
  sendResetCode,
  setBuyerName,
  signInWithPassword,
  toPhone,
  typedPhoneProblem,
} from "@web/lib/shop-auth";
import type { PhoneAnswer, ShopSessionUser } from "@web/lib/shop-auth";
import { ErrorLine, FieldLabel } from "./shop-ui";

// The phone step checkout and the orders page share (plan 0106, "Checkout identity",
// Q18, Q32). The buyer types a number and gets a code:
//
//   a new number    the plain sign-up code; `verify` opens a session on a new account
//   a known number  the plain code answers 409, so the step asks for a sign-in code
//                   (`signIn: true`); with `codeSignIn: false` it asks for the password,
//                   with a reset by code for a forgotten one
//
// `auth-phone` sends every code, keeps its send log and enforces its limits. This file
// adds no limiter and no auth endpoint.

type Step =
  | { name: "phone" }
  | { name: "code"; phone: string; known: boolean }
  | { name: "password"; phone: string }
  | { name: "reset"; phone: string };

export interface PhoneStepProps {
  /** The line above the form. */
  intro: string;
  /** Ask the buyer's name beside the number; a new account takes it. */
  askName?: boolean;
  /** The signed-in buyer whose phone is not verified yet, if any. */
  signedIn: ShopSessionUser | null;
  /** The label of the button that checks the code. */
  verifyLabel?: string;
  onVerified: (details: { name: string; phone: string }) => void;
}

/** Whole seconds until `deadline` (epoch ms), ticking once a second. */
function useSecondsUntil(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PhoneStep({
  intro,
  askName = false,
  signedIn,
  verifyLabel = "Verify and continue",
  onVerified,
}: PhoneStepProps) {
  const ids = useId();
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [name, setName] = useState(signedIn?.name ?? "");
  const [typed, setTyped] = useState(signedIn?.phoneNumber ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const left = useSecondsUntil(resendAt);

  function codeSent() {
    setResendAt(Date.now() + phoneRules.resendSeconds * 1000);
  }

  async function run(task: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch {
      setError(answerText("failed"));
    }
    setBusy(false);
  }

  /** Send the right code for `phone`: sign-up for a new number, sign-in for a known one. */
  async function requestCode(phone: string): Promise<PhoneAnswer> {
    const first = await sendCode(phone);
    if (first !== "exists") {
      if (first === "ok") {
        setStep({ known: false, name: "code", phone });
      }
      return first;
    }
    if (!phoneRules.codeSignIn) {
      setStep({ name: "password", phone });
      return "ok";
    }
    const second = await sendCode(phone, true);
    if (second === "ok") {
      setStep({ known: true, name: "code", phone });
    }
    return second;
  }

  function submitPhone(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (askName && name.trim() === "") {
        setError("Enter your name.");
        return;
      }
      const phone = toPhone(typed);
      if (phone === null) {
        setError(typedPhoneProblem());
        return;
      }
      const answer = await requestCode(phone);
      if (answer === "ok") {
        setCode("");
        codeSent();
      } else {
        setError(answerText(answer));
      }
    });
  }

  function finish(phone: string) {
    onVerified({ name: name.trim(), phone });
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    if (step.name !== "code") {
      return;
    }
    void run(async () => {
      if (code.length !== phoneRules.codeLength) {
        setError(`Enter all ${phoneRules.codeLength} digits of the code.`);
        return;
      }
      const answer = await checkCode(step.phone, code, {
        addToSession: !step.known && signedIn !== null,
        signIn: step.known,
      });
      if (answer !== "ok") {
        setError(answerText(answer));
        return;
      }
      if (!step.known && askName && name.trim() !== "") {
        await setBuyerName(name.trim());
      }
      finish(step.phone);
    });
  }

  function resend() {
    if (step.name !== "code") {
      return;
    }
    void run(async () => {
      const answer = await sendCode(step.phone, step.known);
      if (answer === "ok") {
        codeSent();
      } else {
        setError(answerText(answer));
      }
    });
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (step.name !== "password") {
      return;
    }
    void run(async () => {
      const answer = await signInWithPassword(step.phone, password);
      if (answer === "ok") {
        finish(step.phone);
      } else {
        setError(answerText(answer));
      }
    });
  }

  function startReset() {
    if (step.name !== "password" && step.name !== "code") {
      return;
    }
    const { phone } = step;
    void run(async () => {
      const answer = await sendResetCode(phone);
      if (answer === "ok") {
        setCode("");
        setPassword("");
        codeSent();
        setStep({ name: "reset", phone });
      } else {
        setError(answerText(answer));
      }
    });
  }

  function submitReset(event: FormEvent) {
    event.preventDefault();
    if (step.name !== "reset") {
      return;
    }
    void run(async () => {
      const reset = await resetPassword(step.phone, code, password);
      if (reset !== "ok") {
        setError(answerText(reset));
        return;
      }
      const signIn = await signInWithPassword(step.phone, password);
      if (signIn === "ok") {
        finish(step.phone);
      } else {
        setError(answerText(signIn));
      }
    });
  }

  function back() {
    setError(null);
    setStep({ name: "phone" });
  }

  const phoneField = (
    <div>
      <FieldLabel htmlFor={`${ids}-phone`}>Phone</FieldLabel>
      <Input
        id={`${ids}-phone`}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="send"
        value={step.name === "phone" ? typed : phoneText(step.phone)}
        readOnly={step.name !== "phone"}
        className="read-only:bg-muted h-10"
        placeholder={
          phoneRules.defaultCountryCode ? "01712 345678" : "+880 1712 345678"
        }
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
    </div>
  );

  if (step.name === "phone") {
    return (
      <form className="flex flex-col gap-4" noValidate onSubmit={submitPhone}>
        <p className="text-muted-foreground text-sm">{intro}</p>
        {askName && (
          <div>
            <FieldLabel htmlFor={`${ids}-name`}>Name</FieldLabel>
            <Input
              id={`${ids}-name`}
              autoComplete="name"
              className="h-10"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
        )}
        {phoneField}
        <ErrorLine message={error} />
        <div>
          <Button type="submit" size="lg" className="h-10 px-4" disabled={busy}>
            {busy ? "Sending code…" : "Send code"}
          </Button>
        </div>
      </form>
    );
  }

  if (step.name === "code") {
    const shown = phoneText(step.phone);
    return (
      <form className="flex flex-col gap-4" noValidate onSubmit={submitCode}>
        {phoneField}
        <p className="text-sm">
          {step.known
            ? "Welcome back. This number has an account. Enter the code we sent to sign in."
            : `We sent a ${phoneRules.codeLength}-digit code to ${shown}. Enter it to create your account and continue.`}
        </p>
        <InputOTP
          maxLength={phoneRules.codeLength}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Code from the SMS"
          containerClassName="gap-2"
          onChange={setCode}
        >
          <InputOTPGroup className="gap-2">
            {Array.from({ length: phoneRules.codeLength }, (_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className="size-11 rounded-lg border text-base first:rounded-lg last:rounded-lg"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <div className="text-muted-foreground text-sm">
          {left > 0 ? (
            <span>Resend code in {clock(left)}</span>
          ) : (
            <button
              type="button"
              className="text-foreground underline underline-offset-4"
              disabled={busy}
              onClick={resend}
            >
              Resend code
            </button>
          )}
        </div>
        <ErrorLine message={error} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" size="lg" className="h-10 px-4" disabled={busy}>
            {busy ? "Checking…" : verifyLabel}
          </Button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
            onClick={back}
          >
            Use another number
          </button>
        </div>
        {step.known && (
          <button
            type="button"
            className="self-start text-sm underline underline-offset-4"
            onClick={() => {
              setError(null);
              setStep({ name: "password", phone: step.phone });
            }}
          >
            Use your password instead
          </button>
        )}
      </form>
    );
  }

  if (step.name === "password") {
    return (
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={submitPassword}
      >
        {phoneField}
        <p className="text-sm">
          Welcome back. This number has an account. Enter its password to sign
          in.
        </p>
        <div>
          <FieldLabel htmlFor={`${ids}-password`}>Password</FieldLabel>
          <Input
            id={`${ids}-password`}
            type="password"
            autoComplete="current-password"
            className="h-10"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </div>
        <ErrorLine message={error} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" size="lg" className="h-10 px-4" disabled={busy}>
            {busy ? "Signing in…" : "Sign in and continue"}
          </Button>
          <button
            type="button"
            className="text-sm underline underline-offset-4"
            disabled={busy}
            onClick={startReset}
          >
            Forgot your password? Get a code
          </button>
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4"
          onClick={back}
        >
          Use another number
        </button>
      </form>
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submitReset}>
      {phoneField}
      <p className="text-sm">
        We sent a code to {phoneText(step.phone)}. Enter it with a new password.
      </p>
      <InputOTP
        maxLength={phoneRules.codeLength}
        value={code}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Code from the SMS"
        containerClassName="gap-2"
        onChange={setCode}
      >
        <InputOTPGroup className="gap-2">
          {Array.from({ length: phoneRules.codeLength }, (_, index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className="size-11 rounded-lg border text-base first:rounded-lg last:rounded-lg"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <div>
        <FieldLabel htmlFor={`${ids}-new-password`}>New password</FieldLabel>
        <Input
          id={`${ids}-new-password`}
          type="password"
          autoComplete="new-password"
          className="h-10"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <p className="text-muted-foreground mt-1.5 text-xs">
          12 characters or more.
        </p>
      </div>
      <ErrorLine message={error} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" size="lg" className="h-10 px-4" disabled={busy}>
          {busy ? "Saving…" : "Set password and sign in"}
        </Button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
          onClick={back}
        >
          Use another number
        </button>
      </div>
    </form>
  );
}
