# Plan: a Bangladeshi mobile number schema in `packages/validators`

Grilled: 2026-09-21

## Context

`packages/validators` ships `errorSchema`, `errorBody`, `email`, `id` and `pagination` in `src/common.ts`. A project that takes a Bangladeshi mobile number in a request body has nothing to validate it with, so every route hand-rolls a regex. Issue #147 asks for the shared schema.

The need came out of `sms-khudebarta`. That provider checks `/^\+880\d{10}$/` in `modules/sms-khudebarta/files/khudebarta.ts:41` and rejects anything else with `invalid_number`. The check is dependency-free because `packages/sms` declares `"dependencies": {}` under ADR 0020 and cannot import a Zod schema. The two layers do different jobs. The provider guards an already-E.164 recipient at the gateway edge. This schema guards whatever a person typed at the API request boundary.

Success means a route author writes `bangladeshMobile` instead of a regex, and the value that reaches the sms capability is already in the one form the provider accepts.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Normalize or validate only | Normalize. The schema outputs canonical E.164, `+8801XXXXXXXXX`. `email` in the same package already normalizes through a pipe, and `packages/sms` refuses to normalize, so the boundary layer must. |
| Accepted input forms | `01XXXXXXXXX`, `+8801XXXXXXXXX`, `8801XXXXXXXXX`, `1XXXXXXXXX` and `008801XXXXXXXXX`, each after the separators are removed. |
| The `00` international prefix | Accepted, normalized to `+880`. No national form starts `00`, so it is unambiguous, and it costs one alternation. |
| Separator handling | Allow digits, a space, `-`, `(`, `)`, `.` and a leading `+`. **Reject the input if any other character appears**, then remove the separators and match. The allowed set is a rejection boundary, not a strip list, so an unlisted character fails loudly rather than being silently discarded. This is what stops `hello01712345678world` from stripping down to a valid number. |
| Non-ASCII digits | Rejected. Bengali numerals (`০`–`৯`) do not parse. The skill states ASCII digits only. |
| No `.trim()` in the pipe | The separator removal already drops leading and trailing spaces. `email` needs its trim because it strips nothing; this schema does not. |
| Operator prefix rule | Structural only. The digit after the leading `1` must be `3`–`9`. This rejects `10`, `11` and `12` and needs no maintenance when an operator block moves. No enumerated operator table. |
| Failure message | One message for every rejection class: `must be a Bangladeshi mobile number, for example +8801712345678`. `zValidator`'s hook surfaces `issues[0].message` straight to the client, and an example helps a user more than a diagnosis does. Splitting per class stays available later. |
| File home and export name | A new file `src/phone.ts` exporting `bangladeshMobile` and `BangladeshMobile`. The package exports `"./*": "./src/*.ts"`, so the import path is `@repo/validators/phone`. `src/common.ts` stays reserved for primitives two or more features share, which a single-country schema is not. |
| No general `phone({ country })` | A country option with one supported value invents an abstraction for a caller that does not exist. Adding a second country later is a rename, not a redesign. |
| No optional variant | Callers write `bangladeshMobile.optional()`. `email` ships no optional variant either. |
| Drift guard against the sms provider | A test assertion plus a comment in each file naming the other. The test asserts every accepted output matches `/^\+880\d{10}$/`; the comments tell whoever breaks it where the other half lives. A shared constant is closed off by ADR 0020, since `packages/sms` takes no dependency. |
| Test runner and dependency | The test lands at `modules/validators/files/src/phone.test.ts` and runs on `node:test` through `pnpm test:modules`. No module test imports `zod` today and the repo root has none, so `zod` joins the root `devDependencies` exact-pinned at `4.5.4`, matching the version the scaffold and the module patch already pin. |
| Test file is repo-only | `phone.test.ts` gets no entry in `registry-item.json` `scaffolds`, matching `sms-khudebarta`, whose `khudebarta.test.ts` is also unscaffolded. A scaffolded project receives `phone.ts` alone. |
| No existing caller to migrate | `waitlist.ts` has one `email` field and `feature-flags.ts` has `enabled` and `percentage`. Neither module has a phone field, so nothing adopts this on landing. |

## Approach

One file, one schema, one test file, three edits around them. The schema reuses the `z.string().pipe(...)` shape `email` already uses in `src/common.ts`, and it targets the exact output `modules/sms-khudebarta/files/khudebarta.ts:41` accepts.

The transform runs in a fixed order: reject on a disallowed character, remove the separators, match one of the five forms, emit `+880` plus the ten national digits.

### Phase 1: the schema (built 2026-09-20)

- Add `modules/validators/files/src/phone.ts`.
- Export `bangladeshMobile`, following the order above, with the single failure message.
- Export `export type BangladeshMobile = z.infer<typeof bangladeshMobile>`, per the validators skill rule that a schema and its inferred type ship together.
- Keep the file isomorphic. No Workers types, no Node APIs, no `process.env`.
- Add the comment pointing at `modules/sms-khudebarta/files/khudebarta.ts` and its `+880` regex.

### Phase 2: registration and dependency (built 2026-09-20)

- Add `{ "path": "files/src/phone.ts", "target": "src/phone.ts" }` to the `scaffolds[0].files` array in `modules/validators/registry-item.json`.
- Add `zod` at `4.5.4` to the repo root `devDependencies` so `pnpm test:modules` resolves the import.
- Add the matching comment in `modules/sms-khudebarta/files/khudebarta.ts` pointing back at `phone.ts`.
- Confirm the root addition does not disturb `pnpm deps:check`, which gates template and module-descriptor pins rather than the repo's own workspace deps.

### Phase 3: tests (built 2026-09-20)

- Add `modules/validators/files/src/phone.test.ts` on `node:test`, matching the header comment style of `modules/billing/files/src/config.test.ts`.
- Cover each of the five accepted forms and assert the normalized output, not just that it parsed.
- Cover separator handling: a space, a hyphen, parentheses, a dot, and a mix.
- Cover each rejection class: wrong length, a landline, `10`/`11`/`12`, a non-Bangladeshi country code, a letter anywhere in the string, a Bengali numeral, `01712345678!!!`, an empty string.
- Assert `hello01712345678world` is rejected, since that case is the reason the disallowed-character check exists.
- Assert the output of every accepted case satisfies `/^\+880\d{10}$/`, the provider's own regex, so the two layers stay in agreement.

### Phase 4: documentation (built 2026-09-20)

- Document `bangladeshMobile` in `modules/validators/skills/saasaloy-validators/SKILL.md`, alongside `email`, `id` and `pagination`, and state that it lives in `phone.ts` rather than `common.ts` and why.
- List the five accepted input forms, the allowed separators, the ASCII-digits-only rule, and the normalized output.
- Cross-reference the `saasaloy-sms` skill so a reader sees the two layers and does not read the pair as duplication.
- Run `pnpm lint` and `pnpm test`.

### Rejected alternatives

- **An enumerated operator table** (`013`…`019`). Same accept set as `1[3-9]` today, and it becomes a list to maintain the first time a block is reassigned.
- **A full phone-number library.** Roughly 145 kB with its own metadata release cycle. The sms capability already refused this trade for the same reason.
- **Putting the schema in `common.ts`.** The skill reserves that file for what two or more features reuse.
- **Stripping every non-digit with no rejection check.** Accepts any string with eleven right digits buried in it.
- **Mapping Bengali numerals to ASCII.** Considered and declined. A Bengali-keyboard user retypes in ASCII digits.

## Open questions

None. The grill on 2026-09-21 closed every branch.

## Non-goals

- International phone numbers. If this grows past Bangladesh it is a different decision and a different issue.
- Landlines. Mobile numbers only.
- Any change to `packages/sms` or the `sms-khudebarta` runtime logic. Its dependency-free check stays exactly as it is; only a comment is added.
- Carrier lookup, number portability, or checking that a number is live.
- Non-ASCII numeral input.
