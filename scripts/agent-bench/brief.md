---
autonomy: afk
---

# Product brief

Last updated: 2026-10-23 (hand-written fixture for `scripts/agent-bench.ts`)

- **Name**: Shelfnote
- **Language**: English (`en`)

## Audience

Adults who read 20 or more books a year for pleasure and want to remember what they read. One person, one account, paying for themselves.

## Problem

They finish a book, and three months later they cannot recall the author, when they read it, or what they thought of it. The notes they took sit in a phone's notes app, mixed with shopping lists.

## Current alternative

A notes app on the phone, or a paper notebook. Some use Goodreads and stop because the social feed is noise to them.

## Differentiator

A private log with no social feed. Each book gets a status, a finish date and one paragraph of the reader's own notes, and nothing else.

## Proof

The owner has kept this log in a spreadsheet for four years: 212 books, with a finish date on each one.

## Tone

Quiet and plain, like a good library card. Owner pointed at standardebooks.org.

## Pricing

Confirmed 2026-10-23: Free for up to 50 books, Reader $4/mo for unlimited books, no annual plan yet.

## Where "sign up" goes

The product's own sign-up screen, in the signed-in app.

## Core feature

The product entity is a **book** (table `books`). A signed-in user adds a book with a title, an author, a status (`want`, `reading`, `finished`), an optional finish date and optional notes. The user sees a list of their own books and can add one. An admin sees a list of every book.

## Known gaps

- None the owner knows of.
