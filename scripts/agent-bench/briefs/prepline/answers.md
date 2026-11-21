---
read-back: a
follow-up: Take your first sample answer as written, and go on to the next question.
---

# Owner answers: Prepline

Draft, awaiting the owner's approval in #350. The scripted owner for `node scripts/agent-bench.ts --interview --brief prepline`, a team product that exercises `teams`. The harness sends the answer under `## <n>.` when the agent asks question `<n>` of `saasaloy-setup`, and `read-back` when the agent asks "Build it?". Answer 7 is thin on purpose, so the read-back must settle a weak answer.

## 1. Name

Prepline

## 2. Language

English (`en`)

## 3. Audience

Head chefs of small restaurant kitchens with three to ten cooks, who plan the day's prep for the whole team.

## 4. Problem

The prep list lives on a whiteboard or a sheet taped to the wall. A cook on the late shift cannot see what the morning shift finished, so a task gets done twice or not at all.

## 5. Current alternative

A whiteboard in the kitchen, or a shared spreadsheet that nobody opens during service.

## 6. Differentiator

One shared prep list for each kitchen, by station, that every cook on the team sees on a phone and marks done.

## 7. Proof

I ran this list on paper for one kitchen team for a year. I have no number for it.

## 8. Tone

Short and practical, like a kitchen ticket. I have no reference site.

## 9. Pricing

Free during the beta. No paid plan yet.

## 10. Where "sign up" goes

The product's own sign-up screen, in the signed-in app.

## 11. Entities

Two entities. Both belong to the kitchen: every member of the active organization sees them, and staff read every row in admin.

- Stations. Table `stations`. Fields: `name` text, required. Actions: `list`, `create`, `update`. Screens: as you proposed.
- Prep tasks. Table `prep_tasks`. Fields: `title` text, required; `station` link to `stations`, required; `quantity` text; `status` one of `todo`, `doing`, `done`, required; `due_on` date, required. Actions: `list`, `create`, `update`, `finish`. Screens: as you proposed.

## 12. Order

Stations first, then prep tasks.

## 13. Capabilities

`teams` and `multitenant`, because the entities belong to the kitchen. Nothing else.

## 14. Preview deploy

a. No, keep it on my machine (`deploy: none`).
