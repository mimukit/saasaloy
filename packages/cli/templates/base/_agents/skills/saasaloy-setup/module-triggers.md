# Module triggers

`saasaloy-setup` reads this file to propose the modules of the build. `saasaloy-build` reads it to derive the modules from a brief that has no spec. Plan 0123 settled these rules.

## The floor

The base template is the floor. It ships `apps/web` with the landing page, and it needs no module. No module is fixed. Each module in the build has a reason that cites an answer of the interview or a line of the brief.

## The triggers

Read each row in order. A row adds its modules when its answer is clear. A row is **unclear** when the answers neither call for its modules nor rule them out.

| # | When the answers say | Add | The reason to write |
|---|----------------------|-----|---------------------|
| 1 | The product has at least one entity: a signed-in user makes, tracks or reads something. | `database`, `database-postgres`, `api`, `logger`, `logger-console`, `validators`, `auth`, `shell`, `app` | "The product has an entity (<table>). `saasaloy-feature` needs these to build it." |
| 2 | Row 1 holds. | `email`, `email-console` | "Users sign in, and the password reset mail needs email." The owner may drop them. Then warn: "Without email, users cannot reset a password." |
| 3 | Row 1 holds. | `agent`, `api-keys`, `api-keys-user` | "Every entity action is callable by AI agents with a user's key." The owner may drop them. |
| 4 | Staff must see or manage the data of other users: support, moderation, approval, refunds, or a user list. | `admin` | "Staff <the work the owner named>." |
| 5 | Paid tiers in question 9 that the product charges for itself. | `subscription` or `payment`, with the local provider | "Pricing: <the tiers>." |
| 6 | The audience is a team that shares the product. | `teams` | "Audience: <the answer>." |
| 7 | An entity's `Who may see it` is `the organization`. | `teams`, `multitenant`, `api-keys-organization` in place of `api-keys-user` | "<table> belongs to the organization." |
| 8 | Question 10 sends sign-up to a waitlist on this site. | `waitlist`, and the row 1 floor modules it depends on: `database`, `database-postgres`, `api`, `logger`, `logger-console`, `validators` | "Sign-up goes to a waitlist on this site." |
| 9 | An answer names a capability that another module in `saasaloy list --json` covers, such as file uploads, notifications or feature flags. | That module, with the local provider of each capability it needs | "<the answer>." |

Rules that hold for every row:

- **Users other than the owner are app users.** They call for row 1, not for `admin`. Only staff work calls for `admin`.
- **A module that a pick depends on comes with it.** `teams`, `payment`, `subscription`, `cms`, `feature-flags`, `file-uploads`, `multitenant` and `ecommerce` depend on `admin`. Read `dependsOn` in `saasaloy list --json`, and mark such a module "needed by `<pick>`". Never write a reason of your own for it.
- **Pick the local provider** of each capability: the provider whose name ends in `-console`, or in `-memory` when no `-console` provider exists.
- **Never add a module with a non-empty `needs`.** Add its capability's local provider, and put the vendor step under `## Left for the owner`.
- **Leave out the tooling modules** `ci`, `infra-ci-deploy` and `e2e`. They change how the project is built and checked, not what the product does.
- **No entity and no other trigger:** the list is empty. The build ships the landing page only.

## An unclear row

- **With the owner present:** ask one question for the row, inside the module proposal. Give the module and its reason as one sample, and leaving it out as another. Never assume.
- **With `autonomy: afk` and no spec:** leave the module out. Write it under `## Left for a human` as `- Decide on <module>: <the unclear answer>. Run saasaloy add <module> --yes to add it.`
