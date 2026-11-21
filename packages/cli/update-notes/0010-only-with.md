---
title: Replace onlyWith in local descriptors
version: 0.11.0
---

## What update does

The CLI validates current descriptors without the `onlyWith` key. It translates `onlyWith` in older release snapshots when it reads them for an update.

## What update merges

The CLI uses the older descriptors to render merge bases. It leaves descriptors that you maintain for your own registry to you.

## What you do

In each descriptor you maintain, replace `"onlyWith": "example-driver"` with `"when": { "installed": ["example-driver"] }`. If the entry already has a `when` object, add the driver to `when.installed` and keep the other conditions. Apply the change to both `files` and `scaffolds[].files` entries that use `onlyWith`.

## Verify

Run `saasaloy doctor <registry-directory>`. Check that a test scaffold includes the file when the named module is installed.
