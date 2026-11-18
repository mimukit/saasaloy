---
title: The blog joins the web app's llms.txt
---

This note needs the base note `0005-agent-files`. Apply it first, or the patch has no `apps/web/src/lib/agent-entries.ts` to write into.

## What update does

`cms` adds `apps/web/src/lib/agent-entries/cms.ts` and appends `cmsAgentEntry()` to `agentEntries` in `apps/web/src/lib/agent-entries.ts`. The site's `/llms.txt` gets a section, titled with `config.cms.rssTitle`, that links the blog index, the blog sitemap and the RSS feed. Posts are published at run time and `/llms.txt` is built at build time, so the section names where the posts are listed rather than each post.

## What the merge plan gets

Nothing. Both changes land in files `cms` did not write before.

## What you do

Nothing.

## Verify

```sh
pnpm typecheck
pnpm --filter @repo/web build
grep -n "blog" apps/web/dist/client/llms.txt
```
