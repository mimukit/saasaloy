# QA Plan: validators capability module

_Generated 2026-08-27 · against `69b19e56d4487c30281648d53f8b389751960f76` · covers the `validators` module, its skill, the api/database skill edits, and the cross-manifest divergence note in `scripts/update-deps.ts`_

## Summary

- `saasaloy add validators` scaffolds `packages/validators` (`@repo/validators`), a Zod-only package of shared input schemas, and patches `@repo/validators` into `apps/api/package.json`.
- Working means an api route validates a request against a `@repo/validators/<feature>` schema, the inferred type reaches the handler, and a bad body returns the `{ error: { code, message } }` envelope.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-84-add-the-validators-capability-module`, commit `69b19e5`.
- Repo root: `/home/dev/worktrees/saasaloy/issue-84-add-the-validators-capability-module`. Every command below runs from there unless a step says otherwise.
- The CLI must be built. The agent already ran `pnpm build` green on this commit, so `packages/cli/dist/index.js` exists.
- The playground at `.dev/playground` already carries `web`, `api` and `validators`. Its dependencies are installed and its typecheck is green.
- The api dev server is Vite on port 4000. `$BASE_URL` is `http://localhost:4000`.
- No credentials, no auth token, no feature flag.

Confirm the state before you start:

```sh
node -e 'const s=require("./.dev/playground/saasaloy.json");console.log(s.installed, s.aliases["@validators"])'
```

- [ ] The command prints `[ 'web', 'api', 'validators' ] packages/validators/src`

## Scope note: why this plan is short

`.afkkit/checks.md` holds ten checks for this issue. All ten are flagged `agent`, and there are **no human-only entries**. The agent re-ran all ten against this commit and they all pass; see [Automated verification](#automated-verification-by-ai-agent). The two manual cases below cover only what a command cannot decide: the runtime reply of a validated route, and whether a human can follow the shipped skill.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: playground with `validators` installed | A validated route replies at runtime | 🔴 Critical |
| TC-1.2 | 1: playground with `validators` installed | The skill is followable and the CLI output is clear | 🟡 Normal |

## Scenario 1: playground with `validators` installed

**Setup.** Run once, for every case in this scenario.

1. Open `modules/validators/skills/saasaloy-validators/SKILL.md` and read it top to bottom. You write both files in TC-1.1 from that document.
2. Create the feature schema `.dev/playground/packages/validators/src/signup.ts`. Follow the skill's naming rule and its export rule.

```sh
cat > .dev/playground/packages/validators/src/signup.ts <<'EOF'
import { z } from "zod";
import { email } from "./common";

export const signupInput = z.object({
  email,
  name: z.string().trim().min(1).max(80),
});
export type SignupInput = z.infer<typeof signupInput>;
EOF
```

3. Create the route `.dev/playground/apps/api/src/routes/signup.ts`. Copy the example from the skill's "Using a schema in an api route" section without changing it.

- [ ] Setup complete

### TC-1.1: A validated route replies at runtime  ·  🔴 Critical

**Goal.** A live api route rejects a bad body with the shared `{ error: { code, message } }` envelope and accepts a good body with the parsed values.

**Steps**

1. Start the api dev server in a second terminal. Leave it running for the whole case.

   ```sh
   pnpm -C .dev/playground/apps/api dev
   ```

   - [ ] The server starts and prints a local URL on port 4000
     - no import error for `@repo/validators/signup` or `@repo/validators/common`
     - no warning about a missing workspace link

2. Send a body that fails validation. The email is malformed and `name` is missing.

   ```sh
   curl -i -X POST http://localhost:4000/signup -H 'Content-Type: application/json' -d '{"email":"not-an-email"}'
   ```

   - [ ] The status is `400` and the body is the shared envelope
     - the JSON has one top-level key, `error`
     - `error.code` is `invalid_input`
     - `error.message` names the failing field, for example `email: ...`
     - the body carries no Zod issue array and no stack trace

3. Send a valid body.

   ```sh
   curl -i -X POST http://localhost:4000/signup -H 'Content-Type: application/json' -d '{"email":"  QA@Example.COM ","name":"Qa Tester"}'
   ```

   - [ ] The status is `201` and the reply carries the values the schema transformed
     - `email` is `qa@example.com`, trimmed and lowercased by the shared `email` primitive
     - `name` is `Qa Tester`

4. Send a body that is not JSON at all.

   ```sh
   curl -i -X POST http://localhost:4000/signup -H 'Content-Type: application/json' -d 'not json'
   ```

   - [ ] The api answers with an error status and a readable body, and the dev server stays up

5. Stop the dev server with `Ctrl-C`.

   - [ ] The server exits and releases port 4000

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The skill is followable and the CLI output is clear  ·  🟡 Normal

**Goal.** A reader who knows only `SKILL.md` can place a new schema correctly, and the `add` run tells the reader what it did.

**Steps**

1. Recall the setup you just did. You wrote `src/signup.ts` and the route from the skill alone.

   - [ ] The skill answered every question you had while writing those two files
     - where the file goes, and what import path it gets
     - which primitives `src/common.ts` already provides
     - how to build an error body
     - what the third argument of `zValidator` is for

2. Read the "Rules" section of the skill.

   - [ ] The isomorphism rule is unambiguous about what a schema file may not import

3. Open `modules/api/skills/saasaloy-api/SKILL.md` and `modules/database/skills/saasaloy-database/SKILL.md`.

   - [ ] Each skill sends a reader to the right layer, and the two do not contradict each other
     - the api skill puts request shapes in `@repo/validators`
     - the database skill puts column shapes in `packages/db`

4. Re-apply the module and read the terminal output.

   ```sh
   cd .dev/playground && SAASALOY_REGISTRY_DIR=$(git -C .. rev-parse --show-toplevel)/modules node ../../packages/cli/dist/index.js add validators --force --yes
   ```

   - [ ] The output states what changed, in terms a reader can act on
     - the created files are named
     - the `@validators` alias is reported
     - the patch on `apps/api/package.json` is reported
     - the closing line tells the reader to run `pnpm install`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after both cases above. It removes only the two files you wrote and returns the playground to the state this plan started from.

```sh
rm -f .dev/playground/apps/api/src/routes/signup.ts .dev/playground/packages/validators/src/signup.ts
```

## Automated verification (by AI agent)

_Checks the agent ran itself against commit `69b19e5`. No action needed from the tester; listed here for context and sign-off._

All ten entries in `.afkkit/checks.md` are agent-confirmable. The agent re-ran every one of them after the two fix commits (`7e183e5`, `69b19e5`) landed. Result: **10 pass, 0 fail.**

Commands run:

```sh
cd .dev/playground && SAASALOY_REGISTRY_DIR=<repo>/modules node ../../packages/cli/dist/index.js add validators --yes
```

```sh
node -e 'const p=require("./.dev/playground/packages/validators/package.json");console.log(p.name,p.dependencies.zod,p.scripts.clean,p.devDependencies.rimraf)'
```

```sh
cd .dev/playground && md5sum apps/api/package.json packages/validators/package.json saasaloy.json > /tmp/b.md5 && node ../../packages/cli/dist/index.js add validators --yes && md5sum -c /tmp/b.md5
```

```sh
pnpm -C .dev/playground install && pnpm -C .dev/playground typecheck
```

```sh
cd .dev/playground/packages/validators && node --experimental-strip-types -e 'import("./src/common.ts").then(m=>console.log(m.errorSchema.safeParse({error:{code:"bad_request",message:"x"}}).success, m.errorSchema.safeParse({error:"x"}).success))'
```

```sh
node scripts/update-deps.ts --check
```

```sh
grep -n "validators" README.md modules/README.md && grep -n "@repo/validators" modules/api/skills/saasaloy-api/SKILL.md modules/database/skills/saasaloy-database/SKILL.md
```

```sh
pnpm deps:verify
```

```sh
pnpm test && pnpm build && pnpm typecheck
```

Outcomes:

- ✅ **C1** add scaffolds the package → `@repo/validators` with `zod 4.4.3`, the same string as `modules/api/files/package.json`. `saasaloy.json` gained `@validators` → `packages/validators/src`. The run created `package.json`, `tsconfig.json`, `src/common.ts` and the skill link (4 files).
- ✅ **C2** the api patch is idempotent → `dependencies["@repo/validators"]` is `workspace:*`. A second `add` printed `use --force to re-apply` and all three md5 hashes verified OK.
- ✅ **C3** clean script and typecheck → `"clean": "rimraf -g \"*.tsbuildinfo\""` with `"rimraf": "6.1.3"` exact-pinned. No `rm -rf`. `pnpm -C .dev/playground install` exits 0 and `pnpm -C .dev/playground typecheck` exits 0 with `@repo/validators` in scope. **Re-checked after `7e183e5`**, which dropped `dist` from the script because the package has no build step.
- ✅ **C4** the inferred type reaches the handler → with the skill's route in place, `pnpm -C .dev/playground typecheck` exits 0. Renaming `input.name` to `input.nmae` fails it: `src/routes/signup.ts(19,53): error TS2339: Property 'nmae' does not exist on type '{ email: string; name: string; }'`. The type is the schema's object, not `any`. The file was restored.
- ✅ **C5** `errorSchema` shape → `{ error: { code: "bad_request", message: "x" } }` parses `true`; `{ error: "x" }` parses `false`. `errorBody("not_found","nope")` returns `{"error":{"code":"not_found","message":"nope"}}`.
- ✅ **C6** the skill documents both rules → frontmatter `name: saasaloy-validators`; `registry-item.json` lists `"skills": ["skills/saasaloy-validators"]`; the naming rule is at line 12 and the isomorphism rule at line 56. `.dev/playground/.claude/skills/saasaloy-validators/SKILL.md` exists after the add.
- ✅ **C7** the divergence note → the baseline `--check` run prints the pre-existing `@cloudflare/workers-types` note and no `zod` note. Skewing `modules/validators/files/package.json` to `zod 4.4.2` produced `zod: diverges across manifests — 4.4.2 (modules/validators/files/package.json) vs 4.4.3 (modules/api/files/package.json).` The exit code stayed 1 in both runs, driven by the pending rows, not by the note. The pin was restored. **Re-checked after `69b19e5`**: with `zod` listed in both `dependencies` and `devDependencies` of one manifest, the note printed that manifest path once, not twice.
- ✅ **C8** the READMEs list the module → `README.md:33` names `validators` among the capability modules and `README.md:41` names it in the free-tier list. `modules/README.md:23-25` describes what it scaffolds and the patch it applies.
- ✅ **C9** `pnpm deps:verify` passes → exit 0 on the full `play:init` → install → build → `verify-css` → typecheck chain. `deps:check` lists no pending row for `zod`. `deps:check` still exits 1 on pre-existing drift unrelated to this branch; it exits 1 on `main` too.
- ✅ **C10** the api and database skills place validation → `modules/api/skills/saasaloy-api/SKILL.md:64,72,134` and `modules/database/skills/saasaloy-database/SKILL.md:73,77,145` each state the split. Both files are in the branch diff.
- ✅ **Repo-wide gate** → `pnpm test` exits 0 (10 test files, all in `packages/cli`), `pnpm build` exits 0, `pnpm typecheck` exits 0. The working tree is clean.

## Not covered / needs human judgment

- **Runtime behavior of a validated route.** Only the type level and the schema parse are automated. TC-1.1 covers the real HTTP reply, which no static check reaches.
- **Whether the skill is followable.** A grep proves a sentence exists; only a reader can say the document answers the question it raises. TC-1.2 covers it.
- **`pnpm deps:update` in its interactive mode.** Only `--check` was exercised. The note code path is shared between the two modes.
- **`saasaloy add validators --dry-run` and `--diff`.** Neither output was inspected on this branch.
- **The divergence note for a range or a bare spec.** `buildDivergenceNotes` skips anything that is not `kind === "exact"`, so a caret range never reaches the note.
- **Enforcement of the isomorphism rule.** It is prose in the skill. Nothing checks a schema file for a Workers type or a Node API import.
- **Deployment.** No `wrangler deploy` was run and no Cloudflare account was used.
- **Security, permissions, concurrency, accessibility, performance, browser compatibility.** These dimensions do not apply. The change adds a schema package, a descriptor, a skill and a report line. It adds no auth boundary, no shared mutable state, no UI, and no data volume.
