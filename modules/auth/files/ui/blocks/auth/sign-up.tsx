import { siteName } from "@repo/ui";
import {
  AUTH_LINK_CLASS,
  AuthAlert,
  AuthCard,
  readField,
  useAuthSubmit,
} from "@repo/ui/blocks/auth/auth-card";
import type { SignInValues } from "@repo/ui/blocks/auth/sign-in";
import { Button } from "@repo/ui/components/shell/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";

// The sign-up card. `auth` ships it into `@repo/ui` when `shell` is installed, and `app`
// renders it on `/sign-up`. The app passes `onSubmit`, calls its auth client there, and
// returns a message to show on failure. See "Wire-up" in the `saasaloy-auth` skill.

// The browser's check for the hint below. The server's rule is `MIN_PASSWORD_LENGTH` in
// `packages/auth/src/auth.ts`; change both together.
const MIN_PASSWORD_LENGTH = 12;

export interface SignUpValues extends SignInValues {
  name: string;
}

export function SignUpCard({
  onSubmit,
  signInHref,
  title,
  description = "It takes a minute. You can change these later.",
}: {
  /** Resolve to a message to show it in the alert line, or to `undefined` on success. */
  onSubmit: (values: SignUpValues) => Promise<string | undefined>;
  /** The sign-in route, for the footer link. */
  signInHref: string;
  title?: string;
  description?: string;
}) {
  // Computed here, not as a parameter default: the React Compiler cannot reorder a
  // template literal in a default.
  const heading = title ?? `Create your ${siteName} account`;
  const { pending, error, handleSubmit } = useAuthSubmit(
    (data) => ({
      name: readField(data, "name"),
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
        <>
          Already have an account?{" "}
          <a href={signInHref} className={AUTH_LINK_CLASS}>
            Sign in
          </a>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input type="text" name="name" autoComplete="name" required />
        </Field>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input type="email" name="email" autoComplete="email" required />
        </Field>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <FieldDescription>
            At least {MIN_PASSWORD_LENGTH} characters.
          </FieldDescription>
        </Field>
        <AuthAlert error={error} />
        <Button type="submit" size="lg" loading={pending} className="mt-1">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
