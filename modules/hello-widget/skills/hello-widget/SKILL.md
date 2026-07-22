---
name: hello-widget
description: Worked-example module runbook, copied into .claude/skills/ by `saasaloy add hello-widget`.
---

# hello-widget

A minimal feature module used to exercise the applier end to end: it `dependsOn` the
`hello` capability, drops two files under `@web`, declares npm deps and an env var, and
ships this skill folder. `saasaloy add hello-widget` copies it into
`.claude/skills/hello-widget/` and records every file in `.saasaloy/manifest.json`.
