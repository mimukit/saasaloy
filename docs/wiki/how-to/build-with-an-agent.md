# Build with an agent

An AI coding agent can build a Saasaloy MVP for you in one session. Describe your product and answer the remaining questions. Approve the product brief and spec first. Then approve the design and mockup images. The agent builds without further questions and leaves a seeded local app on a branch you review.

No module list is fixed. The smallest MVP is the landing page with copy from your answers. The agent proposes each module from your answers and gives the reason for it, and you approve the list. A product with entities usually gets sign-in through the customer `app`, transactional email through the console provider, and access for AI agents (`agent` with `api-keys` and `api-keys-user`). It gets an `admin` app only when staff work needs one, or when a module you pick depends on it.

## 1. Give the prompt

Open your coding agent in an empty folder, and give it one sentence:

```text
Build a SaaS MVP with Saasaloy (https://github.com/mimukit/saasaloy). Interview me first.
```

That is the whole setup. You write no file, scaffold nothing, and copy no env values first. The agent finds [`llms.txt`](../../llms.txt) at the repo root, checks its prerequisites (Node, pnpm, a git identity, network access, `GITHUB_TOKEN`), and tells you when one is missing. Then it runs `saasaloy init`, which installs the project, writes the local env files and commits the scaffold on `main`.

Stay in the session for the interview. An agent that runs with nobody to answer, such as `claude -p`, has no one to interview, so it stops and says why instead of guessing your product.

## 2. Answer the interview

The agent runs the `saasaloy-setup` skill. It uses the facts in your description and asks for missing answers. It gives you sample answers you can take, edit, or replace.

| # | What it asks | Where the answer goes |
|---|--------------|-----------------------|
| 1 to 10 | name, language, audience, problem, current alternative, differentiator, proof, tone, pricing, and where "sign up" goes | `docs/product-brief.md` |
| 11 | the entities: the agent proposes one table for each thing your user makes, tracks or reads (its fields, who may see it, its actions), and you correct it | `docs/product-spec.md` |
| 12 | the order to build the entities in | `docs/product-spec.md` |
| 13 | the module proposal: each module derived from your answers, with its reason, for you to approve | `docs/product-spec.md` |

The agent never invents a price, a proof, a customer name or a URL. "No proof yet" and "no pricing yet" are good answers. When an answer stays thin after two follow-ups, the agent records it and says what the copy will leave out.

A module that needs an account you do not have yet, such as Stripe, gets its local provider in the build, and the vendor step goes to your list. A wish that no module covers goes to a "Not in this build" list in the spec, not into the code.

## 3. Approve the product brief and spec

The interview ends with one message that shows everything at once:

- the brief, with each thin answer marked;
- the module list, with the reason for each module; the build installs these modules and no others;
- each entity with its screens: the app list, the app detail, the create and update form, and the admin list when the list holds `admin`;
- the wishes this build leaves out;
- the steps that stay with you.

Confirm the scope before design starts. You can accept a thin answer as written. The agent records it as `weak-accepted:` and leaves its claim out of the copy. If the scope needs a change, ask for it before you approve.

## 4. Review the design and mockup images

After product approval, the agent proposes colors, typography and component styles. It generates images for the landing page and main customer workflow, including mobile. If the agent has no image generation tool, you can supply images or approve a theme preset.

Approve the current round or ask for changes. The agent shows the revised round before asking again. After approval, it records the design and sets `autonomy: afk`. It starts the build in the same session without further questions. Tell the agent at design approval if you want to stay at the keyboard for the build.

Keep the approved images accessible if you resume on another machine. You can give the agent the same files from a new location.

## 5. Read the build log

`docs/build-log.md` is the build's output. The agent writes one section per stage, and one per entity:

| Section | What it holds |
|---------|---------------|
| `## Intake` | the brief and spec checks, the env step, the testing mode, and each wish that is not in this build |
| `## Brand` | the product name and locale, the landing copy and the approved design or preset |
| `## Validate` | the approved modules of the `validate` stage, such as `database`, `api` and `waitlist` |
| `## MVP` | the other approved modules, such as `auth`, `app`, `email` and `agent` |
| `## Feature: <table>` | one section for each entity of the spec, in your order |
| `## Blocked` | what stopped the build, when something did |
| `## Left for a human` | each step only you can take |

Each section names its commit. When the build stops, fix what `## Blocked` names, and start the agent again with the same sentence. It reads the log first and continues from the last stage or entity with a commit.

## 6. Review `build/mvp`

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
4. With `admin` installed, sign in to `http://localhost:3001` as the seeded admin. `pnpm db:seed` prints its password.
5. Merge the branch when you are happy with it.

## Start from a brief you already have

A brief written earlier still works. Put it in the empty folder as `product-brief.md`, with `autonomy: afk` in its frontmatter, and a `product-spec.md` beside it if you have one. Then say "The product brief is in ./product-brief.md" in the prompt. The agent runs `init` and the build with no interview. With no spec it derives the modules from the brief, logs the reason for each one, and leaves an unclear module for you under `## Left for a human`.

This is also the one case that runs headless, because no question is left to ask:

```sh
claude -p "$(cat prompt.txt)" --permission-mode bypassPermissions --max-turns 400
```

Bypass mode skips every permission prompt, so run it only in a folder and on a machine you are willing to let an agent change.

## What stays your job

The build never does these, and it lists them under `## Left for a human`:

- Push the branch.
- Deploy with `pnpm deploy:production`. [Deploy to Cloudflare](deploy-to-cloudflare.md) covers it.
- Create a vendor account: a paid Cloudflare plan, a domain, a mail or payment provider. The build installs the local provider and names the vendor step.
- Edit a secret, or set a production value.
- Delete data outside the local dev database.

_Verified against `main`@`07d89b7c` on 2026-11-25._
