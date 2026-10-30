# Build with an agent

An AI coding agent can build a Saasaloy MVP with nobody at the keyboard. You give it two files and one sentence. It ends at a local app that runs, has seed data and passes its tests, on a branch you review. This page covers what you write, what you say, what comes back, and what stays your job.

The MVP it builds is the README's "Build the MVP" row: sign-in through the customer `app`, an `admin` app, transactional email through the console provider, landing copy from your brief, and one product entity from the database to the screen.

## 1. Write the brief

The agent builds from `product-brief.md` and from nothing else. It cannot invent the product, so you answer the questions first.

1. Scaffold a scratch project with `npx saasaloy@latest init scratch`, open it in your coding agent, and run `/saasaloy-setup`.
2. Answer the ten questions: name, language, audience, problem, current alternative, differentiator, proof, tone, pricing, and where "sign up" goes.
3. Answer yes to the last question, "Run the build unattended?". That writes `autonomy: afk` into the brief's frontmatter.
4. Copy `docs/product-brief.md` into an empty folder as `product-brief.md`, and delete the scratch project.

The brief must be complete. Every one of the ten sections needs an answer, and none may be tagged `weak:`. An honest "no proof yet" counts as an answer. With a gap, the build stops before it installs anything and names the section in `docs/build-log.md`.

## 2. Write the env file

Put a dotenv file named `env` beside the brief. The build loads it with `saasaloy env --from-file`, so no value passes through a prompt or your shell history. Local values are enough for the MVP:

```dotenv
BETTER_AUTH_SECRET=<32 or more random characters>
BETTER_AUTH_URL=http://localhost:4000
PUBLIC_API_URL=http://localhost:4000
EMAIL_PROVIDER=console
EMAIL_FROM=hello@example.test
LOGGER_PROVIDER=console
LOG_LEVEL=info
PUBLIC_SITE_URL=http://localhost:3000
```

`openssl rand -base64 32` prints a usable secret. Leave out every vendor key: the build uses local providers only.

## 3. Give the prompt

Start the agent in the folder that holds the two files, and give it one sentence:

```text
Build a SaaS MVP with Saasaloy (https://github.com/mimukit/saasaloy). The product brief is in ./product-brief.md and the env values are in ./env.
```

The agent finds [`llms.txt`](../../llms.txt) at the repo root. It tells the agent to run `saasaloy init`, then the `saasaloy-build` skill that every project ships. For Claude Code with no prompts, run it headless:

```sh
claude -p "$(cat prompt.txt)" --permission-mode bypassPermissions --max-turns 400
```

Bypass mode skips every permission prompt, so run it only in a folder and on a machine you are willing to let an agent change.

## 4. Read the build log

`docs/build-log.md` is the build's output. The agent writes one section per stage:

| Section | What it holds |
|---------|---------------|
| `## Intake` | the brief moved to `docs/`, the brief check, the env load, the testing mode |
| `## Brand` | the product name and locale, the landing copy, the theme preset |
| `## Validate` | the database, api, logger and validators modules |
| `## MVP` | `shell`, `auth`, `app`, `admin`, `email` and `email-console` |
| `## Feature` | the entity it picked from your brief, and why |
| `## Blocked` | what stopped the build, when something did |
| `## Left for a human` | each step only you can take |

Each stage section names its commit. When the build stops, fix what `## Blocked` names, and start the agent again with the same prompt. It reads the log first and continues from the last stage with a commit.

## 5. Review `build/mvp`

The work sits on the `build/mvp` branch, one commit per stage, and nothing is pushed. Each commit passed `pnpm check`: typecheck, lint, test and build.

1. Run `git log --oneline main..build/mvp` to see the stages.
2. Run `pnpm dev`, and open `http://localhost:3000` for the landing page and `http://localhost:3002` for the customer app.
3. Sign up in the app. Then request a password reset for that address. The app has no reset screen yet, so call the api:

   ```sh
   curl -X POST http://localhost:4000/auth/request-password-reset \
     -H 'Content-Type: application/json' -H 'Origin: http://localhost:3002' \
     -d '{"email":"you@example.test","redirectTo":"http://localhost:3002/"}'
   ```

   The reset mail prints in the api's terminal, because `email-console` writes mail there.
4. Sign in to `http://localhost:3001` as the seeded admin. `pnpm db:seed` prints its password.
5. Merge the branch when you are happy with it.

## What stays your job

The build never does these, and it lists them under `## Left for a human`:

- Push the branch.
- Deploy with `pnpm deploy:production`. [Deploy to Cloudflare](deploy-to-cloudflare.md) covers it.
- Create a vendor account: a paid Cloudflare plan, a domain, a mail or payment provider. A module whose `needs` names one is left out.
- Edit a secret, or set a production value.
- Delete data outside the local dev database.
