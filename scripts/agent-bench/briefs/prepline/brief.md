---
autonomy: afk
---

# Product brief

Last updated: 2026-11-17 (draft fixture for `scripts/agent-bench.ts`)

- **Name**: Prepline
- **Language**: English (`en`)

## Audience

Head chefs of small restaurant kitchens with three to ten cooks, who plan the day's prep for the whole team.

## Problem

The prep list lives on a whiteboard or a sheet taped to the wall. A cook on the late shift cannot see what the morning shift finished, so a task gets done twice or not at all.

## Current alternative

A whiteboard in the kitchen, or a shared spreadsheet that nobody opens during service.

## Differentiator

One shared prep list for each kitchen, by station, that every cook on the team sees on a phone and marks done.

## Proof

weak-accepted: The owner ran this list on paper for one kitchen team for a year. There is no number behind it yet.

## Tone

Short and practical, like a kitchen ticket. The owner named no reference site.

## Pricing

Free during the beta. No paid plan yet.

## Where "sign up" goes

The product's own sign-up screen, in the signed-in app.

## Core feature

The product is for a team. A head chef signs up, makes an organization for the kitchen, and invites the cooks. Two entities belong to the organization, and every member of the active organization sees them:

- A **station** (table `stations`): a name, such as "grill" or "pastry".
- A **prep task** (table `prep_tasks`): a title, a station, an optional quantity, a status (`todo`, `doing`, `done`) and a due date. A cook marks a task done.

An admin sees a list of every station and every prep task.

## Known gaps

- None the owner knows of.
