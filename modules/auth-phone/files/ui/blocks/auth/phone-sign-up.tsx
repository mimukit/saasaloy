import { siteName } from "@repo/ui";
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

// The first step of a phone sign-up: the number. `auth-phone` ships it into `@repo/ui`
// when `shell` is installed, and `app` renders it on `/phone/sign-up`. The app sends the
// code in `onSubmit`, then shows `CodeInputCard` from `./code-input` and, once the code
// opens a session, `NewPasswordCard` from `./new-password`. See "Wire-up" in the
// `saasaloy-auth-phone` skill.

export function PhoneSignUpCard({
  onSubmit,
  signInHref,
  defaultPhone,
  defaultCountryCode,
  title,
  description = "We text a code to your number to check it is yours. Then you choose a password.",
}: {
  /** Called with the number as typed. Resolve to an alert, or to `undefined` once sent. */
  onSubmit: (phone: string) => Promise<PhoneAlert | undefined>;
  /** The phone sign-in route, for the footer link. */
  signInHref: string;
  defaultPhone?: string;
  defaultCountryCode?: string;
  title?: string;
  description?: string;
}) {
  const heading = title ?? `Create your ${siteName} account`;
  const { pending, alert, handleSubmit } = usePhoneSubmit(
    (data) => readField(data, "phone"),
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
