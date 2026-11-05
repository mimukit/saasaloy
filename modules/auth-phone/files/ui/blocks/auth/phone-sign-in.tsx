import { useState } from "react";
import type { SubmitEvent } from "react";

import { siteName } from "@repo/ui";
import {
  AUTH_LINK_CLASS,
  AuthCard,
  readField,
} from "@repo/ui/blocks/auth/auth-card";
import { Button } from "@repo/ui/components/shell/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";

// The phone sign-in card, and the pieces the other phone cards share: the alert with an
// optional link, the submit cycle that shows it, and the number field. `auth-phone` ships
// it into `@repo/ui` when `shell` is installed, and `app` renders it on `/phone/sign-in`.
// The app owns the call. It passes `onSubmit`, turns the typed number into E.164, calls
// its auth client, and returns what to show. See "Wire-up" in the `saasaloy-auth-phone`
// skill.
//
// No IO and no config read here, per the package rule: the app hands in the country code
// the field's hint names, and every link.

/** A link inside an alert, such as "Create an account" under a number with none. */
export interface PhoneAlertLink {
  label: string;
  href: string;
}

/** What a phone card shows on failure: a message, or a message with one link. */
export type PhoneAlert = string | { message: string; link: PhoneAlertLink };

/** The alert line. The same place and role as `AuthAlert`, with room for the link. */
export function PhoneAlertLine({ alert }: { alert: PhoneAlert | null }) {
  if (alert === null) {
    return null;
  }
  const message = typeof alert === "string" ? alert : alert.message;
  return (
    <p role="alert" className="text-destructive-foreground text-sm">
      {message}
      {typeof alert === "string" ? null : (
        <>
          {" "}
          <a href={alert.link.href} className={AUTH_LINK_CLASS}>
            {alert.link.label}
          </a>
        </>
      )}
    </p>
  );
}

/**
 * `useAuthSubmit` for a phone card: the same cycle, with a `PhoneAlert` in place of the
 * string. `undefined` means success, and the card only drops its pending state.
 */
export function usePhoneSubmit<Values>(
  read: (data: FormData) => Values,
  onSubmit: (values: Values) => Promise<PhoneAlert | undefined>
) {
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<PhoneAlert | null>(null);

  async function run(values: Values) {
    setAlert(null);
    setPending(true);
    // Not a `finally` block: the React Compiler cannot lower one.
    let result: PhoneAlert | undefined;
    try {
      result = await onSubmit(values);
    } catch (error) {
      setPending(false);
      throw error;
    }
    setPending(false);
    setAlert(result === undefined || result === "" ? null : result);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    void run(read(new FormData(event.currentTarget)));
  }

  return { pending, alert, handleSubmit };
}

/**
 * The number field, named `phone`. With `defaultCountryCode` set, the app turns a number
 * that starts with `0` into E.164, so the hint offers both forms. Unset, it asks for `+`.
 */
export function PhoneNumberField({
  defaultValue,
  defaultCountryCode,
  onValueChange,
}: {
  defaultValue?: string;
  defaultCountryCode?: string;
  /** Called with the typed text on each edit, for a link that carries the number. */
  onValueChange?: (typed: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>Phone number</FieldLabel>
      <Input
        type="tel"
        name="phone"
        inputMode="tel"
        autoComplete="tel"
        defaultValue={defaultValue}
        onChange={(event) => onValueChange?.(event.target.value)}
        required
      />
      <FieldDescription>
        {defaultCountryCode === undefined
          ? "Start with + and the country code."
          : `Start with 0, or with ${defaultCountryCode}.`}
      </FieldDescription>
    </Field>
  );
}

export interface PhoneSignInValues {
  /** The number as typed. The app turns it into E.164. */
  phone: string;
  password: string;
}

export function PhoneSignInCard({
  onSubmit,
  signUpHref,
  resetHref,
  defaultPhone,
  defaultCountryCode,
  title,
  description = "Use your phone number and password.",
}: {
  /** Resolve to an alert to show it above the button, or to `undefined` on success. */
  onSubmit: (values: PhoneSignInValues) => Promise<PhoneAlert | undefined>;
  /** The phone sign-up route, for the footer link. */
  signUpHref: string;
  /** The reset route for the number typed so far, so the reset screen opens with it. */
  resetHref: (typed: string) => string;
  defaultPhone?: string;
  defaultCountryCode?: string;
  title?: string;
  description?: string;
}) {
  const heading = title ?? `Sign in to ${siteName}`;
  const [typed, setTyped] = useState(defaultPhone ?? "");
  const { pending, alert, handleSubmit } = usePhoneSubmit(
    (data) => ({
      phone: readField(data, "phone"),
      password: readField(data, "password"),
    }),
    onSubmit
  );

  return (
    <AuthCard
      title={heading}
      description={description}
      footer={
        <>
          New here?{" "}
          <a href={signUpHref} className={AUTH_LINK_CLASS}>
            Create an account
          </a>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <PhoneNumberField
          defaultValue={defaultPhone}
          defaultCountryCode={defaultCountryCode}
          onValueChange={setTyped}
        />
        <Field>
          <div className="flex w-full items-baseline justify-between gap-3">
            <FieldLabel>Password</FieldLabel>
            <a
              href={resetHref(typed)}
              className={`${AUTH_LINK_CLASS} text-xs font-normal`}
            >
              Set or reset your password
            </a>
          </div>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <PhoneAlertLine alert={alert} />
        <Button type="submit" size="lg" loading={pending} className="mt-1">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
