import {
  AuthAlert,
  AuthCard,
  readField,
  useAuthSubmit,
} from "@repo/ui/blocks/auth/auth-card";
import { Button } from "@repo/ui/components/shell/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@repo/ui/components/shell/field";
import { Input } from "@repo/ui/components/shell/input";

// The new password step: one field, a length hint, and no confirm field. `auth-phone`
// ships it into `@repo/ui` when `shell` is installed and renders it after a sign-up code
// and after a reset code. It names no sign-in method, so an email reset screen renders it
// the same way. The app passes `onSubmit`, saves the password there, and returns a message
// to show on failure.

// The browser's check for the hint below. The server's rule is `MIN_PASSWORD_LENGTH` in
// `packages/auth/src/auth.ts`; change both together.
const MIN_PASSWORD_LENGTH = 12;

export function NewPasswordCard({
  onSubmit,
  onBack,
  username,
  title = "Choose a password",
  description = "You sign in with this password from now on.",
  submitLabel = "Save password",
}: {
  /** Called with the password. Resolve to a message to show it, or to `undefined`. */
  onSubmit: (password: string) => Promise<string | undefined>;
  /** Shows a Back button when given, such as back to the code. */
  onBack?: () => void;
  /**
   * The account's sign-in name (an email or a number). It goes in a hidden field, so a
   * password manager files the new password under the right account.
   */
  username?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
}) {
  const { pending, error, handleSubmit } = useAuthSubmit(
    (data) => readField(data, "password"),
    onSubmit
  );

  return (
    <AuthCard title={title} description={description}>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {username === undefined ? null : (
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            readOnly
            hidden
          />
        )}
        <Field>
          <FieldLabel>New password</FieldLabel>
          <Input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            autoFocus
            required
          />
          <FieldDescription>
            At least {MIN_PASSWORD_LENGTH} characters.
          </FieldDescription>
        </Field>
        <AuthAlert error={error} />
        <Button type="submit" size="lg" loading={pending} className="mt-1">
          {submitLabel}
        </Button>
        {onBack === undefined ? null : (
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        )}
      </form>
    </AuthCard>
  );
}
