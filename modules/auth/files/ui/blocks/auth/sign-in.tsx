import { siteName } from "@repo/ui";
import {
  AUTH_LINK_CLASS,
  AuthAlert,
  AuthCard,
  readField,
  useAuthSubmit,
} from "@repo/ui/blocks/auth/auth-card";
import { Button } from "@repo/ui/components/shell/button";
import { Field, FieldLabel } from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";

// The sign-in card. `auth` ships it into `@repo/ui` when `shell` is installed, and each
// app renders it on its own route: `app` on `/sign-in`, `admin` on `/login`. The app owns
// the call. It passes `onSubmit`, calls its auth client there, navigates on success, and
// returns a message to show on failure. See "Wire-up" in the `saasaloy-auth` skill.
//
// Email and password only, matching `emailAndPassword` in the auth module's server config.

export interface SignInValues {
  email: string;
  password: string;
}

export function SignInCard({
  onSubmit,
  signUpHref,
  title,
  description = "Use the email you signed up with.",
}: {
  /** Resolve to a message to show it in the alert line, or to `undefined` on success. */
  onSubmit: (values: SignInValues) => Promise<string | undefined>;
  /** The sign-up route. Omit it, as `admin` does, and the card has no footer. */
  signUpHref?: string;
  title?: string;
  description?: string;
}) {
  // Computed here, not as a parameter default: the React Compiler cannot reorder a
  // template literal in a default.
  const heading = title ?? `Sign in to ${siteName}`;
  const { pending, error, handleSubmit } = useAuthSubmit(
    (data) => ({
      email: readField(data, "email"),
      password: readField(data, "password"),
    }),
    onSubmit
  );

  return (
    <AuthCard
      title={heading}
      description={description}
      footer={
        signUpHref === undefined ? undefined : (
          <>
            New here?{" "}
            <a href={signUpHref} className={AUTH_LINK_CLASS}>
              Create an account
            </a>
          </>
        )
      }
    >
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input type="email" name="email" autoComplete="username" required />
        </Field>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <AuthAlert error={error} />
        <Button type="submit" size="lg" loading={pending} className="mt-1">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
