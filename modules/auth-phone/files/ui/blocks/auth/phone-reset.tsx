import {
  AUTH_LINK_CLASS,
  AuthCard,
  readField,
} from "@repo/ui/blocks/auth/auth-card";
import {
  PhoneAlertLine,
  PhoneNumberField,
  usePhoneSubmit,
} from "@repo/ui/blocks/auth/phone-sign-in";
import type { PhoneAlert } from "@repo/ui/blocks/auth/phone-sign-in";
import { Button } from "@repo/ui/components/shell/button";

// The first step of "Set or reset your password": the number. It serves an account that
// forgot its password and one that never had one, because the reset endpoint sets the
// first password too. `auth-phone` ships it into `@repo/ui` when `shell` is installed,
// and `app` renders it on `/phone/reset`, then `CodeInputCard` and `NewPasswordCard`.

export function PhoneResetCard({
  onSubmit,
  signInHref,
  defaultPhone,
  defaultCountryCode,
  notice,
  title = "Set or reset your password",
  description = "We text a code to your number. Then you choose a new password.",
}: {
  /** Called with the number as typed. Resolve to an alert, or to `undefined` once sent. */
  onSubmit: (phone: string) => Promise<PhoneAlert | undefined>;
  /** The phone sign-in route, for the footer link. */
  signInHref: string;
  defaultPhone?: string;
  defaultCountryCode?: string;
  /** Why the app opened this screen, such as an account with no password yet. */
  notice?: string;
  title?: string;
  description?: string;
}) {
  const { pending, alert, handleSubmit } = usePhoneSubmit(
    (data) => readField(data, "phone"),
    onSubmit
  );

  return (
    <AuthCard
      title={title}
      description={description}
      footer={
        <>
          Remembered it?{" "}
          <a href={signInHref} className={AUTH_LINK_CLASS}>
            Sign in
          </a>
        </>
      }
    >
      {notice === undefined ? null : (
        <p
          role="status"
          className="bg-muted text-foreground mt-4 rounded-lg px-3 py-2 text-sm"
        >
          {notice}
        </p>
      )}
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <PhoneNumberField
          defaultValue={defaultPhone}
          defaultCountryCode={defaultCountryCode}
        />
        <PhoneAlertLine alert={alert} />
        <Button type="submit" size="lg" loading={pending} className="mt-1">
          Send code by SMS
        </Button>
      </form>
    </AuthCard>
  );
}
