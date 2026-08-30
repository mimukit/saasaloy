---
name: create-provider
description: Author a provider module for a Saasaloy capability that owns a provider interface (modules/<capability>-<provider>/) — the descriptor, the single provider file, and the registration patch. Use when adding a second (or third) implementation behind an existing capability's interface — "add a Resend/SES/Plunk email provider", "support Postmark", "write an email-<x> module" — even if the word "provider" isn't used.
---

# create-provider

Guide for authoring a **provider module**: a `saasaloy:feature` module that supplies one
implementation of a capability's provider interface. It is the narrow sibling of
[`create-module`](../create-module/SKILL.md) — read that one first for the general descriptor
rules; this one covers only what is different when the module you're writing is a provider.

A provider module is deliberately tiny. If yours is growing a second file or a scaffold, you are
probably authoring a capability, not a provider — go back to `create-module`.

**Ground truth:** `docs/plans/plan-email-capability-module-2026-08-04.md` (the design this pattern
came from), [ADR 0001](../../../docs/adr/adr-0001-all-in-on-cloudflare-2026-07-22.md) (when a
capability may be multi-provider at all), [ADR 0020](../../../docs/adr/adr-0020-capability-owns-its-vendor-packages-2026-07-24.md)
(where the vendor dependency goes).

## Is a provider module the right shape here?

ADR 0001 commits the stack to Cloudflare and cuts the multi-cloud adapter layer. Its 2026-08-04
amendment carves out exactly one exception, and a new provider must land inside it:

- **Stateful infrastructure stays single-provider** — a database, an object store, a queue. Swapping
  one is a data migration, and an adapter layer would hide a difference that matters.
- **Stateless third-party services may be multi-provider** when the capability owns the
  abstraction — sending email, sending an SMS. There is no migration; the endpoint is
  interchangeable.

A stateful capability can still offer a **choice made once, at install time**, without becoming
multi-provider. That is a driver module, and `database-d1` / `database-postgres` are the only pair
today. It is a different shape with its own rules, so if that is what you are writing, stop here
and read ADR 0023 instead.

Also check that a real interface already exists. Provider modules only work where a capability has
scaffolded a workspace with a `providers` registry to append to. Inventing that interface is
capability work.

## The shape (all modes)

```text
modules/<capability>-<provider>/
  registry-item.json     # type: saasaloy:feature, dependsOn: ["<capability>"]
  files/<provider>.ts    # ONE file: the interface implementation
```

Five rules hold for every mode:

1. **Name is `<capability>-<provider>`** and matches the directory (`email-cloudflare`,
   `email-resend`). The folder name, the descriptor `name`, and the module coordinate are one
   string.
2. **`type` is `saasaloy:feature`, `dependsOn` is `["<capability>"]`.** A provider is typed
   `feature` because the descriptor schema has exactly two tiers; it isn't really one. That wart is
   recorded in `CONTEXT.md` → *Provider module* — don't add a third tier to fix it.
3. **One file, into the capability's `providers/` folder**, via the capability's alias:
   `{ "path": "files/<provider>.ts", "target": "@<capability>/providers/<provider>.ts" }`.
4. **Register with a `plugin-array` patch** on the capability's barrel. This is the existing
   codemod (`packages/cli/src/lib/patch/ts-module.ts`), unchanged — it adds the import and appends
   the call idempotently.
5. **The npm dependency, if any, goes in the *capability's* `package.json`** through a
   `package-json-dependency` patch — never the descriptor's `dependencies[]` (which merges into the
   project root) and never another workspace. Only the capability's own workspace may import a
   provider SDK (ADR 0020).

Provider modules ship **no skill folder of their own**. The capability's skill is where a provider
gets documented; add a row to its provider table and, if the provider needs out-of-band setup, a
short runbook section there. One skill per capability keeps a consumer from installing five
near-identical runbooks.

> **Drivers are the exception, and they are not providers.** `database-d1` and `database-postgres`
> each ship a skill folder, carry `scaffolds[]`, and replace files the capability would otherwise
> own. They can do that because they exclude each other with `conflictsWith`, so a project installs
> exactly one and receives exactly one runbook. That is a **driver module**, recorded in
> [ADR 0023](../../../docs/adr/adr-0023-database-driver-split-2026-08-28.md) and `CONTEXT.md`, not
> a licence to grow a provider. If your module is mutually exclusive with a sibling, read that ADR.
> If it is one of several that coexist behind an interface, every rule on this page still binds
> you.

### Why the whole descriptor, and not one swappable function body

Providers differ in **descriptor** surface, not just code. That asymmetry is the entire reason each
one is its own module:

| | binding provider (`email-cloudflare`) | HTTP provider (`email-resend`) |
|---|---|---|
| `patches` → `apps/api/wrangler.jsonc` | a binding | — |
| `patches` → the capability's `package.json` | — | the SDK dependency |
| `patches` → the capability's barrel | register | register |
| `envVars` | none — the binding *is* the credential | the API key |

## Mode: `email`

The only mode implemented today. Add a new mode here (`sms`, `kv`, …) when a second capability
grows a provider interface; keep the shared rules above in one place and each mode concrete.

**Interface:** `EmailProvider` in `packages/email/src/provider.ts`.

```ts
import { EmailError } from "../provider";
import type { EmailEnv, EmailProvider, EmailResult, ResolvedEmailMessage } from "../provider";

export function resend(): EmailProvider {
  return {
    name: "resend", // the value EMAIL_PROVIDER must hold to select this provider
    async send(env: EmailEnv, message: ResolvedEmailMessage): Promise<EmailResult> {
      // …send, then return the service's own id
      return { messageId: "…" };
    },
  };
}
```

Contract points that are easy to get wrong:

- **The message arrives resolved.** `from` is already filled in from `EMAIL_FROM`, `to` is already
  an array, `text` is already derived from `html`. Don't redo any of it, and don't add defaults of
  your own.
- **`name` is the `EMAIL_PROVIDER` value**, and it must be unique across providers. It is *not*
  required to match the exported factory — `email-console`'s factory is `consoleEmail` precisely so
  the generated import can't shadow the global `console`.
- **Normalize every failure into `EmailError`** with one of the four codes
  (`sender_not_verified`, `rate_limited`, `too_large`, `provider_error`), an honest `retryable`,
  and the vendor's raw code in `providerCode`. Map only codes you have actually seen; let the rest
  fall through to `provider_error` / `retryable: false`. A wrong `retryable: true` means duplicate
  mail.
- **Never retry, sleep, or queue inside `send()`.** The caller decides — a retry loop holds the
  Worker's response open.
- **Read secrets off the `env` argument**, never `process.env` (it doesn't exist on Workers), and
  declare each one in the descriptor's `envVars` with a human description.

**Descriptor, HTTP-provider flavour:**

```jsonc
{
  "name": "email-resend",
  "type": "saasaloy:feature",
  "dependsOn": ["email"],
  "dependencies": [],                       // stays empty — see the patch below
  "envVars": { "RESEND_API_KEY": "…" },     // provider-owned, never in the core
  "patches": [
    { "file": "packages/email/package.json", "kind": "package-json-dependency",
      "section": "dependencies", "name": "resend", "range": "4.0.1" },
    { "file": "packages/email/src/index.ts", "kind": "plugin-array",
      "exportName": "email", "arrayProp": "providers", "call": "resend",
      "import": { "name": "resend", "from": "./providers/resend" } }
  ],
  "files": [{ "path": "files/resend.ts", "target": "@email/providers/resend.ts" }],
  "scaffolds": []
}
```

`email-cloudflare` is the binding flavour of the same shape: no npm dependency and no secret,
plus a `wrangler-binding` patch adding `send_email` to `apps/api/wrangler.jsonc` (`matchOn: "name"`
— `send_email` entries are keyed by `name`, not `binding`).

A provider that needs an SDK version must pin it **exactly** — `"range": "4.0.1"`, never `^4.0.1`
or `~4.0.1`.

Pin it by hand the first time, and check the version against npm rather than typing one from
memory. After that the tooling keeps it current. `pnpm deps:update` and `pnpm deps:check` read the
`range` of every `package-json-dependency` patch as a third dependency site alongside a
descriptor's `dependencies[]` and `devDependencies[]`, so a provider's SDK pin gets the same
cooldown and within-major gate as everything else (ADR 0016, amended for #85). This used to be the
one place drift went unnoticed. It no longer is, which also means a patch missing `name`, `range`
or a `section` naming a real dependency map now fails the run outright.

## Verify before you call it done

The install path a provider must survive is a **clean project**, one command:

```sh
pnpm play:reset
cd .dev/playground && ./saasaloy add email-<provider>
```

That resolves `email` first, scaffolds `packages/email`, drops your file, and applies your patches
in one run — a provider's file target and patch point both resolve against a workspace that didn't
exist when the run started (`buildPlan` collects scaffold aliases up front; patches execute after
every file is written). Then run it **a second time** and confirm it is a no-op: one entry in the
`providers` array, one binding in `wrangler.jsonc`, comments intact.

## Authoring checklist

- [ ] The capability is a stateless third-party service, not stateful infrastructure (ADR 0001).
- [ ] `modules/<capability>-<provider>/registry-item.json`, `name` matching the directory.
- [ ] `type: saasaloy:feature`, `dependsOn: ["<capability>"]`, `scaffolds: []`.
- [ ] Exactly one file, targeted at `@<capability>/providers/<provider>.ts`.
- [ ] A `plugin-array` patch registering it on the capability's barrel.
- [ ] Any npm dependency patched into the **capability's** `package.json`, exact-pinned.
- [ ] `envVars` declares every secret the provider reads; none baked into files.
- [ ] Failures normalized into the capability's error type, `retryable` set honestly.
- [ ] No skill folder — the capability's skill gains a row (and a runbook section if it needs one).
- [ ] Installed twice on a clean playground: second run changes nothing.
