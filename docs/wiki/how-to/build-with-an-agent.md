# Build with an agent

An AI coding agent can build a Saasaloy MVP for you in one session. You give it one sentence, answer its questions once, and confirm one read-back. Then it builds with no more questions, and ends at a local app that runs, has seed data and passes its tests, on a branch you review. This page covers what you say, what the agent asks, what comes back, and what stays your job.

The MVP it builds is the README's "Build the MVP" row: sign-in through the customer `app`, an `admin` app, transactional email through the console provider, access for AI agents (the `agent` module, with `api-keys` and `api-keys-user`, or `api-keys-organization` when an entity belongs to the organization), landing copy from your answers, and every entity of your product from the database to the screen. The modules you pick in the interview come on top.

## 1. Give the prompt

Open your coding agent in an empty folder, and give it one sentence:

```text
Build a SaaS MVP with Saasaloy (https://github.com/mimukit/saasaloy). Interview me first.
```

That is the whole setup. You write no file, scaffold nothing, and copy no env values first. The agent finds [`llms.txt`](../../llms.txt) at the repo root, checks its prerequisites (Node, pnpm, a git identity, network access, `GITHUB_TOKEN`), and tells you when one is missing. Then it runs `saasaloy init`, which installs the project, writes the local env files and commits the scaffold on `main`.

Stay in the session for the interview. An agent that runs with nobody to answer, such as `claude -p`, has no one to interview, so it stops and says why instead of guessing your product.

## 2. Answer the interview

The agent runs the `saasaloy-setup` skill. It asks about fourteen questions, two or three at a time, and each one comes with three sample answers you can take, edit, or replace.

| # | What it asks | Where the answer goes |
|---|--------------|-----------------------|
| 1 to 10 | name, language, audience, problem, current alternative, differentiator, proof, tone, pricing, and where "sign up" goes | `docs/product-brief.md` |
| 11 | the entities: the agent proposes one table for each thing your user makes, tracks or reads (its fields, who may see it, its actions), and you correct it | `docs/product-spec.md` |
| 12 | the order to build the entities in | `docs/product-spec.md` |
| 13 | the optional modules, such as `teams` or `subscription`, from `saasaloy list --json` | `docs/product-spec.md` |
| 14 | whether to deploy a preview when the build is done | the brief's frontmatter: `deploy: preview` or `deploy: none` |

The agent never invents a price, a proof, a customer name or a URL. "No proof yet" and "no pricing yet" are good answers. When an answer stays thin after two follow-ups, the agent records it and says what the copy will leave out.

A module that needs an account you do not have yet, such as Stripe, gets its local provider in the build, and the vendor step goes to your list. A wish that no module covers goes to a "Not in this build" list in the spec, not into the code.

## 3. Confirm the read-back

The interview ends with one message that shows everything at once:

- the brief, with each thin answer marked;
- the module list;
- each entity with its screens: the app list, the app detail, the create and update form, and the admin list;
- the wishes this build leaves out;
- the steps that stay with you.

Confirm it once. That one answer accepts each thin answer as written (the brief tags it `weak-accepted:`), approves the screens, and writes `autonomy: afk` into the brief's frontmatter. To change something, say what, and the agent shows the read-back again. To stay at the keyboard during the build, say so here, and the build asks before each stage.

The agent then starts the `saasaloy-build` skill in the same session. It asks you nothing after the read-back.

## 4. Read the build log

`docs/build-log.md` is the build's output. The agent writes one section per stage, and one per entity:

| Section | What it holds |
|---------|---------------|
| `## Intake` | the brief and spec checks, the env step, the testing mode, and each wish that is not in this build |
| `## Brand` | the product name and locale, the landing copy, the theme preset |
| `## Validate` | the database, api, logger and validators modules, and your picks of that stage |
| `## MVP` | `shell`, `auth`, `app`, `admin`, `email`, `email-console`, `agent`, `api-keys` and `api-keys-user` (`api-keys-organization` in its place when an entity belongs to the organization), and your other picks |
| `## Feature: <table>` | one section for each entity of the spec, in your order |
| `## Blocked` | what stopped the build, when something did |
| `## Left for a human` | each step only you can take |

Each section names its commit. When the build stops, fix what `## Blocked` names, and start the agent again with the same sentence. It reads the log first and continues from the last stage or entity with a commit.

## 5. Review `build/mvp`

The work sits on the `build/mvp` branch, one commit per stage and one per entity, and nothing is pushed. Each commit passed `pnpm check`: typecheck, lint, test and build.

1. Run `git log --oneline main..build/mvp` to see the stages and the entities.
2. Run `pnpm dev`, and open `http://localhost:3000` for the landing page and `http://localhost:3002` for the customer app.
3. Sign up in the app, and open each entity's list from the nav. Then request a password reset for that address. The app has no reset screen yet, so call the api:

   ```sh
   curl -X POST http://localhost:4000/auth/request-password-reset \
     -H 'Content-Type: application/json' -H 'Origin: http://localhost:3002' \
     -d '{"email":"you@example.test","redirectTo":"http://localhost:3002/"}'
   ```

   The reset mail prints in the api's terminal, because `email-console` writes mail there.
4. Sign in to `http://localhost:3001` as the seeded admin. `pnpm db:seed` prints its password.
5. Merge the branch when you are happy with it.

## Start from a brief you already have

A brief written earlier still works. Put it in the empty folder as `product-brief.md`, with `autonomy: afk` in its frontmatter, and a `product-spec.md` beside it if you have one. Then say "The product brief is in ./product-brief.md" in the prompt. The agent runs `init` and the build with no interview. With no spec it builds the MVP set on `database-postgres` and one entity from the brief.

This is also the one case that runs headless, because no question is left to ask:

```sh
claude -p "$(cat prompt.txt)" --permission-mode bypassPermissions --max-turns 400
```

Bypass mode skips every permission prompt, so run it only in a folder and on a machine you are willing to let an agent change.

## What stays your job

The build never does these, and it lists them under `## Left for a human`:

- Push the branch.
- Deploy with `pnpm deploy:production`. [Deploy to Cloudflare](deploy-to-cloudflare.md) covers it.
- Deploy the preview, when you answered yes to question 14. The build records the choice and does not deploy yet.
- Create a vendor account: a paid Cloudflare plan, a domain, a mail or payment provider. The build installs the local provider and names the vendor step.
- Edit a secret, or set a production value.
- Delete data outside the local dev database.

_Verified against `main`@`b86486c3` on 2026-11-21._
