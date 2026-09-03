---
name: saasaloy-email-react
description: Runbook for the opt-in JSX email templates in packages/email-react — React Email as the render engine on top of the email capability. Use when authoring or changing a JSX email template, deciding between a tagged template and a JSX one, running the react-email preview server, or fixing a call site that forgot to await a JSX template.
---

# email-react — JSX templates on top of `@repo/email`

`packages/email-react` (`@repo/email-react`) adds a second way to write an email body. It does not
replace the first. The `email` capability still ships the tagged-template idiom (`html`, `layout`,
`deriveText`) with zero runtime dependencies, and every provider consumes the identical
`{ subject, html, text }` object either way.

What this module adds: [React Email](https://react.email) as the render engine, so a template is
JSX built from tested client-safe primitives, plus a preview server that renders it in a browser
while you edit.

## The one thing that is different: a JSX template is async

`@react-email/render`'s `render()` returns a `Promise<string>` under the `workerd` export
condition, so a JSX template cannot be the core's synchronous `EmailTemplate<Props>`. This module
declares its own type instead, and leaves the core contract untouched:

```ts
type ReactEmailTemplate<Props = void> = (props: Props) => Promise<EmailContent>;
```

At the call site that is one `await` inside the spread:

```ts
import { createEmail } from "@repo/email";
import { welcome } from "@repo/email-react/templates/welcome";

const mail = createEmail(c.env);
await mail.send({ to: user.email, ...(await welcome({ name, appName, ctaUrl })) });
```

Forget the `await` and you spread a `Promise` into the message, so `subject` and `html` arrive as
`undefined` and the send fails at the provider rather than at the template. TypeScript catches it;
do not silence it with a cast. [ADR 0031](../../../../docs/adr/adr-0031-react-email-is-an-opt-in-render-engine-2026-09-03.md)
records why the core was not widened to `EmailContent | Promise<EmailContent>` instead.

The `waitUntil` and `try/catch` shapes in the `saasaloy-email` skill work unchanged — the promise
the template returns is awaited before `send()` is called, not instead of it.

## Writing a template

`src/templates/welcome.tsx` is the worked example. Copy it. Four things it does that every template
should do:

```tsx
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import { safeUrl } from "@repo/email";
import { defineReactTemplate } from "../define";

export interface ResetProps { name: string; resetUrl: string }

export function ResetEmail({ name, resetUrl }: ResetProps) {
  const href = safeUrl(resetUrl); // 2
  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your password</Preview>
      <Body>
        <Container>
          <Heading>Hi {name}.</Heading>
          <Text>Use the link below within the hour.</Text>
          <Text><Button href={href}>Choose a new password</Button></Text>
        </Container>
      </Body>
    </Html>
  );
}

export const resetPassword = defineReactTemplate<ResetProps>((props) => ({ // 1
  element: <ResetEmail {...props} />,
  subject: "Reset your password",
}));

export default function ResetPreview() { // 3
  return <ResetEmail name="Ada" resetUrl="https://app.acme.com/reset/abc" />;
}
```

1. **`defineReactTemplate` does the rendering.** Hand it `(props) => ({ subject, element })` and it
   returns the `ReactEmailTemplate`. It renders the element twice — once for `html`, once with
   `{ plainText: true }` for `text` — and returns `{ subject, html, text }`. Never call `render()`
   yourself in a template; the helper is the only place the two passes stay in step.
2. **`safeUrl` on every caller-supplied `href`, exactly as in a tagged template.** JSX escapes
   `{name}` and stops markup, but a `javascript:` URL holds no markup to escape and would reach the
   inbox as a working link. `safeUrl` is re-exported from `@repo/email-react` as well, so one import
   line covers it. It throws on anything that is not `https:` (or `http:` on localhost).
3. **The default export is the preview wrapper.** `email dev` lists every file under
   `--dir` and renders its **default export with no arguments**, so the default is a zero-argument
   component bound to sample props. Application code imports the named template, never the default.
4. **The body component is its own named export**, so the template and the preview share one
   definition instead of two that drift.

### Plaintext

`text` comes from React Email's own plaintext renderer, not from the core's `deriveText()`.
`deriveText()` reads the single-column markup the tagged `layout()` emits; React Email emits nested
tables, and `render({ plainText: true })` is the renderer built for them. To override, write your
own `text` into the object at the call site — the core keeps an explicit `text` over anything
derived:

```ts
await mail.send({ to, ...(await welcome(props)), text: "Plain words instead." });
```

### Styling

Inline `style` objects only. Email clients strip `<style>` blocks and ignore most of CSS, so keep
styling inline and the structure a single column, the same constraint the tagged `layout()` works
under. Hoist the style objects to a module-level `const` as the worked example does, so the JSX
stays readable. `@react-email/components` also exports a `Tailwind` wrapper; it compiles classes to
inline styles at render time and costs bundle weight in the Worker, so reach for it only if you
want it.

There is no JSX twin of the tagged `layout()`, on purpose. Templates compose `Html`, `Head`,
`Preview`, `Body`, `Container` directly, so there is no second bespoke layout to keep in step with
the first.

## The preview server

```bash
pnpm --filter @repo/email-react dev
```

That runs `email dev --dir src/templates` — the `react-email` package installs its CLI under the
bin name `email`, not `react-email`. It starts on http://localhost:3000, lists every template in
the folder, and hot-reloads as you edit. It is a development tool: it never runs in the Worker, and
both `react-email` and `@react-email/ui` are devDependencies, so neither reaches a deploy.

`@react-email/ui` is declared up front on purpose. Without it the CLI stops on an interactive
"would you like to install it?" prompt, which hangs any non-interactive run.

The preview renders the **default export**. A template file with no default export does not appear
in the list.

## When to pick JSX over a tagged template

Pick JSX when the email has real layout — columns, buttons, images, a header and footer that have
to survive Outlook. That is what React Email's primitives are tested for, and hand-writing the
table markup those clients need is where hand-rolled HTML ages worst.

Pick a tagged template when the message is a paragraph and a link. It stays synchronous, it costs
no bundle weight, and `@repo/email` alone can send it.

Mixing the two per template is expected and needs no flag. A project that installs `email-react`
keeps every tagged template it already had.

## What this module does not touch

`packages/email` and every provider are unchanged: no edit to `provider.ts`, `define.ts` or
`render.ts`, no provider change, no new patch against `packages/email`. The module scaffolds
`packages/email-react` and patches one dependency line into `apps/api/package.json`. Removing it
takes the workspace back out; the dependency line is one of the patch kinds `saasaloy remove`
cannot yet reverse, so take that line out by hand.

## The `jsx` compiler option lives in the shared base

`packages/tsconfig/base.json` sets `"jsx": "react-jsx"`, and every workspace inherits it. That is
not cosmetic. Internal packages are consumed as source, so `apps/api`'s own `tsc --noEmit` compiles
`packages/email-react/src/templates/*.tsx` as soon as a route imports one; with the option set only
in this package's tsconfig, that run fails with `TS6142: … but '--jsx' is not set`. There is no
tsconfig patch kind, so the option cannot be added to `apps/api/tsconfig.json` at `add` time. The
setting is inert for a workspace with no `.tsx` file in it.

Keep it in the base if you edit that file. Do not delete this package's own `"jsx"` line either —
it states what the package needs rather than relying on the base to keep saying it.

## Bundle weight

React Email renders inside the Worker at request time, because template props are per-recipient and
"render at build time" degenerates into placeholder substitution. That costs bundle size, measured
and recorded in [ADR 0031](../../../../docs/adr/adr-0031-react-email-is-an-opt-in-render-engine-2026-09-03.md).
There is no budget gate on it: the module is opt-in, so only a project that adds it pays.

## Pinned React

`packages/email-react` pins the same exact `react` version as `packages/ui`. Two different pins put
two Reacts in one project. `pnpm verify:pins` enforces the match and runs first inside
`pnpm deps:verify`; change one pin and change the other in the same commit.
