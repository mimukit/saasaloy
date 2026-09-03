import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import { safeUrl } from "@repo/email";
import { defineReactTemplate } from "../define";

// The JSX twin of `@repo/email`'s `src/templates/welcome.ts`, with the same props and the
// same output shape. Copy this file to start a new one. There is no registry and no
// discovery step — import the template you want and spread it into `send()`:
//
//   const mail = createEmail(c.env);
//   await mail.send({ to: user.email, ...(await welcome({ name, appName, ctaUrl })) });
//
// The `await` inside the spread is the one difference from a tagged template.
// `@react-email/render` renders asynchronously under the `workerd` export condition, so
// this template returns a promise. See
// docs/adr/adr-0031-react-email-is-an-opt-in-render-engine-2026-09-03.md.

export interface WelcomeProps {
  /** Display name of the person receiving this. JSX escapes it. */
  name: string;
  appName: string;
  /**
   * Absolute `https:` URL — a relative one has nothing to resolve against in an inbox.
   * Checked by `safeUrl`, which throws rather than render a link it can't vouch for.
   */
  ctaUrl: string;
}

const styles = {
  body: {
    backgroundColor: "#f6f7f9",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    margin: "0",
    padding: "24px 0",
  },
  button: {
    backgroundColor: "#1f2933",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontWeight: 600,
    padding: "12px 20px",
    textDecoration: "none",
  },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "560px",
    padding: "32px",
  },
  footer: { color: "#7b8794", fontSize: "12px", margin: "0" },
  heading: { fontSize: "22px", lineHeight: "1.3", margin: "0 0 16px" },
  rule: { borderColor: "#e4e7eb", margin: "32px 0 16px" },
  text: { margin: "0 0 24px" },
} as const;

/** The sample props the preview server renders with. Also the fixture for a smoke test. */
export const welcomePreviewProps: WelcomeProps = {
  appName: "Acme",
  ctaUrl: "https://app.acme.com",
  name: "Ada",
};

/**
 * Build the element on its own, so the preview wrapper below and the template share one
 * definition rather than two that drift.
 */
export function WelcomeEmail({ appName, ctaUrl, name }: WelcomeProps) {
  // Validated, not merely escaped. JSX escapes `{name}` and stops markup, but a
  // `javascript:` URL has no markup in it to escape and would reach the inbox as a
  // working link. Any template dropping a caller's value into an `href` needs this line;
  // that's why the worked example carries it.
  const href = safeUrl(ctaUrl);

  return (
    <Html lang="en">
      <Head />
      <Preview>{`Your ${appName} account is ready.`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Welcome, {name}.</Heading>
          <Text style={styles.text}>
            Your {appName} account is ready. There&rsquo;s nothing else to set
            up — pick up where you left off whenever you like.
          </Text>
          <Text style={styles.text}>
            <Button href={href} style={styles.button}>
              Open {appName}
            </Button>
          </Text>
          <Text style={styles.text}>
            If you didn&rsquo;t create this account, you can ignore this email.
          </Text>
          <Hr style={styles.rule} />
          <Text style={styles.footer}>
            You&rsquo;re receiving this because someone signed up for {appName}{" "}
            with this address.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const welcome = defineReactTemplate<WelcomeProps>((props) => ({
  element: <WelcomeEmail {...props} />,
  subject: `Welcome to ${props.appName}`,
}));

// The preview-server wrapper. `react-email dev --dir src/templates` lists every file in
// this folder and renders its **default export** with no arguments, so the default is a
// zero-argument component bound to the sample props above. It exists for the preview
// only; application code imports the named `welcome`.
export default function WelcomePreview() {
  return <WelcomeEmail {...welcomePreviewProps} />;
}
