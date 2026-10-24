import { useState } from "react";
import type { ReactNode, SubmitEvent } from "react";

import { siteName } from "@repo/ui";
import { BrandMark } from "@repo/ui/blocks/shell/brand-mark";

// The frame the sign-in and sign-up blocks share: one card with the brand mark and the site
// name, a title, a description, the form and an optional footer. Each form places
// `AuthAlert` above its button, where the admin login has always shown its error. `auth`
// writes it with the two blocks, and only when `shell` is installed, because it renders the
// shell's brand mark and the blocks render the shell's primitives.
//
// It renders the card and nothing around it. The page canvas is the app's: `app` centres
// the card on `bg-sidebar`, `admin` on `bg-background`. No IO here, per the package rule:
// the app hands in `onSubmit`, and the card never learns where the values go.

export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  /** The line under the form, such as the link to the other screen. Omit it for none. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-card text-card-foreground border-border w-full max-w-sm rounded-2xl border p-6 shadow-xs/5 sm:p-7">
      <div className="mb-5 flex items-center gap-2.5">
        <BrandMark />
        <span className="text-sm font-semibold">{siteName}</span>
      </div>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      {children}
      {footer === undefined ? null : (
        <p className="text-muted-foreground mt-6 text-center text-sm">
          {footer}
        </p>
      )}
    </div>
  );
}

/** The message `onSubmit` returned, or nothing when there is none. */
export function AuthAlert({ error }: { error: string | null }) {
  // `role="alert"` announces the failure to a screen reader without moving focus, so the
  // caret stays in the field the visitor is about to correct.
  return error === null ? null : (
    <p role="alert" className="text-destructive-foreground text-sm">
      {error}
    </p>
  );
}

/** The link style the footers use: underlined text with a visible focus ring. */
export const AUTH_LINK_CLASS =
  "text-foreground focus-visible:ring-ring rounded-sm font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2";

/** A text field's value, or `""` when the form holds no text under that name. */
export function readField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The submit cycle both blocks run. It reads the form, calls `onSubmit`, and shows the
 * string `onSubmit` resolves to as the error. `undefined` or an empty string means
 * success: the app navigates away, and the block only drops its pending state.
 *
 * A rejection is the app's to handle. The block resets its pending state and lets the
 * rejection through, so the button never stays stuck on a spinner and the failure still
 * reaches the console.
 */
export function useAuthSubmit<Values>(
  read: (data: FormData) => Values,
  onSubmit: (values: Values) => Promise<string | undefined>
) {
  const [pending, setPending] = useState(false);
  const [alertText, setAlertText] = useState<string | null>(null);

  async function run(values: Values) {
    setAlertText(null);
    setPending(true);

    // Not a `finally` block: the React Compiler cannot lower one, so it bails out of the
    // whole component. The `catch` resets the state and rethrows instead.
    let message: string | undefined;
    try {
      message = await onSubmit(values);
    } catch (error) {
      setPending(false);
      throw error;
    }
    setPending(false);
    setAlertText(message === undefined || message === "" ? null : message);
  }

  // A plain handler, so the form's `onSubmit` gets the void function it expects.
  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(read(new FormData(event.currentTarget)));
  }

  return { pending, error: alertText, handleSubmit };
}
