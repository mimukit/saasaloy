---
read-back: a
follow-up: Take your first sample answer as written, and go on to the next question.
---

# Owner answers: Shelfnote

The scripted owner for `node scripts/agent-bench.ts --interview --brief shelfnote`. The harness sends the answer under `## <n>.` when the agent asks question `<n>` of `saasaloy-setup`, and `read-back` when the agent asks "Build it?". The answers say what `brief.md` says.

## 1. Name

Shelfnote

## 2. Language

English (`en`)

## 3. Audience

Adults who read 20 or more books a year for pleasure and want to remember what they read. One person, one account, paying for themselves.

## 4. Problem

They finish a book, and three months later they cannot recall the author, when they read it, or what they thought of it. The notes they took sit in a phone's notes app, mixed with shopping lists.

## 5. Current alternative

A notes app on the phone, or a paper notebook. Some use Goodreads and stop because the social feed is noise to them.

## 6. Differentiator

A private log with no social feed. Each book gets a status, a finish date and one paragraph of the reader's own notes, and nothing else.

## 7. Proof

I have kept this log in a spreadsheet for four years: 212 books, with a finish date on each one.

## 8. Tone

Quiet and plain, like a good library card. I like standardebooks.org.

## 9. Pricing

Free for up to 50 books. Reader, $4 a month, for unlimited books. No annual plan yet. Confirmed today.

## 10. Where "sign up" goes

The product's own sign-up screen, in the signed-in app.

## 11. Entities

One entity only, Books. Table `books`. Fields: `title` text, required; `author` text, required; `status` one of `want`, `reading`, `finished`, required; `finished_on` date; `notes` long text. Who may see it: the owner; staff read every row in admin. Actions: `list`, `create`, `update`. Screens: as you proposed.

## 12. Order

Books is the only entity, so it goes first.

## 13. Capabilities

Nothing beyond the MVP set.

## 14. Database driver

`database-d1`, as you recommend.

## 15. Preview deploy

a. No, keep it on my machine (`deploy: none`).
