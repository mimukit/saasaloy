import type { SmsTemplate } from "../provider";

// A worked example of the template contract: `(props) => { body }`. Copy this file to
// start a new one. Templates are plain functions — no registry, no discovery, no build
// step; import the one you want and spread it into `send()`:
//
//   await createSms(c.env).send({ to: user.phone, ...verificationCode({ code, appName }) });
//
// There is no `html` tag and no `layout` here, unlike `@repo/email`'s templates: an SMS
// body is plain text all the way to the handset, so there is no markup for a caller's
// value to inject and nothing to escape. What replaces escaping as the thing to be careful
// about is **length** — see the comment on the return below.

export interface VerificationCodeProps {
  /** The one-time code itself. Keep it short; every character is billable. */
  code: string;
  /** Your product's name, as the recipient would recognize it in a notification. */
  appName: string;
  /** How long the code stays valid. Say it, or the recipient will retry a dead code. */
  expiresInMinutes: number;
}

export const verificationCode: SmsTemplate<VerificationCodeProps> = ({
  code,
  appName,
  expiresInMinutes,
}) => ({
  // Written to fit one GSM-7 segment (160 septets) with room for a long `appName`. This is
  // the discipline templates on this channel need: nothing here truncates, so a body that
  // runs past 160 is silently a two-part message and twice the price. The characters that
  // make that happen early are the nine that cost two septets each — `^ { } \ [ ~ ] |` and
  // `€` — and any emoji at all, which drops the whole message to UCS-2 and a 70-character
  // budget. Check yours with `measureSegments(body)` before shipping it.
  //
  // "Never share it" earns its place: a one-time code arriving by SMS is the thing social
  // engineers phone people about, and naming the app is what lets a recipient notice the
  // message doesn't match the call they're on.
  body:
    `${code} is your ${appName} verification code. ` +
    `It expires in ${expiresInMinutes} minutes. Never share it with anyone.`,
});
