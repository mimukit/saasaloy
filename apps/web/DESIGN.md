---
version: alpha
name: "Saasaloy"
description: "The cobalt blueprint system of the Saasaloy public site, from the round 10 mockup approved for issue #287."
omitted:
  - section: spacing
    reason: "Tailwind's default scale is used unchanged"
colors:
  background: "#f6f7f9"
  foreground: "#0b2253"
  card: "#ffffff"
  card-foreground: "#0b2253"
  primary: "#315fe8"
  primary-foreground: "#ffffff"
  highlight: "#315fe8"
  secondary: "#eaeffd"
  secondary-foreground: "#315fe8"
  muted: "#eaeef8"
  muted-foreground: "#626b78"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "#cbd6f5"
  ring: "#315fe8"
  dark-background: "#101722"
  dark-foreground: "#eef2f8"
  dark-card: "#161e2d"
  dark-card-foreground: "#eef2f8"
  dark-highlight: "#8fa8ff"
  dark-secondary: "#222b41"
  dark-secondary-foreground: "#8fa8ff"
  dark-muted: "#1d2638"
  dark-muted-foreground: "#a9b5c7"
  dark-destructive: "oklch(0.704 0.191 22.216)"
  dark-border: "#303b59"
  dark-ring: "#8fa8ff"
typography:
  headline-display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 4.5rem
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: -0.035em
  headline-section:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 3rem
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline-md:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.875rem
    fontWeight: 700
    lineHeight: 2.25rem
    letterSpacing: -0.025em
  wordmark:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 2rem
    letterSpacing: -0.02em
  lead:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: 1.75rem
  body-lg:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.75rem
  body-md:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  body-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  label-md:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  code-md:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  code-sm:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
rounded:
  none: 0px
  full: 9999px
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-md}"
  page-dark:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-foreground}"
  wordmark:
    textColor: "{colors.highlight}"
    typography: "{typography.wordmark}"
  wordmark-dark:
    textColor: "{colors.dark-highlight}"
  hero-title:
    textColor: "{colors.foreground}"
    typography: "{typography.headline-display}"
  hero-title-highlight:
    textColor: "{colors.highlight}"
  hero-title-highlight-dark:
    textColor: "{colors.dark-highlight}"
  section-title:
    textColor: "{colors.highlight}"
    typography: "{typography.headline-section}"
  section-title-dark:
    textColor: "{colors.dark-highlight}"
  section-lead:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.lead}"
  section-lead-dark:
    textColor: "{colors.dark-muted-foreground}"
  error-title:
    textColor: "{colors.foreground}"
    typography: "{typography.headline-md}"
  body-large:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body-lg}"
  body-small:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body-sm}"
  technical-label:
    textColor: "{colors.highlight}"
    typography: "{typography.code-sm}"
  technical-label-dark:
    textColor: "{colors.dark-highlight}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    height: 2.5rem
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    height: 2.5rem
  button-secondary-dark:
    backgroundColor: "{colors.dark-secondary}"
    textColor: "{colors.dark-secondary-foreground}"
  command-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.code-md}"
    rounded: "{rounded.none}"
    height: 2.5rem
  command-field-dark:
    backgroundColor: "{colors.dark-card}"
    textColor: "{colors.dark-foreground}"
  filter-tab:
    backgroundColor: "{colors.card}"
    textColor: "{colors.highlight}"
    typography: "{typography.code-sm}"
    rounded: "{rounded.none}"
  filter-tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
  type-tag:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.code-sm}"
    rounded: "{rounded.none}"
  stage-marker:
    backgroundColor: "{colors.background}"
    textColor: "{colors.highlight}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    size: 2rem
  stage-marker-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
  stage-row-active:
    backgroundColor: "{colors.muted}"
  stage-row-active-dark:
    backgroundColor: "{colors.dark-muted}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
  card-dark:
    backgroundColor: "{colors.dark-card}"
    textColor: "{colors.dark-card-foreground}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.primary-foreground}"
  destructive-text-dark:
    textColor: "{colors.dark-destructive}"
  focus-ring:
    backgroundColor: "{colors.ring}"
  focus-ring-dark:
    backgroundColor: "{colors.dark-ring}"
  border:
    backgroundColor: "{colors.border}"
  border-dark:
    backgroundColor: "{colors.dark-border}"
---

# Saasaloy Design System

## Overview

The site reads as a technical drawing of the product. Fine cobalt lines on pale paper, a faint graph-paper grid, and isometric line art show what a Saasaloy project holds: an application, its source files, a database, an email service. The visual source is the round 10 mockup that the owner approved for issue #287, in `.dev/mockup-287/round-10-full-page/`. That mockup replaced the lime direction of the README banner with the cobalt blueprint direction recorded in `docs/plans/0091-plan-public-site-and-brand-2026-10-26.md`.

The mockup leads the code here. `apps/web/src/styles/brand.css` holds the values this file records, and a change to one goes into the other in the same edit.

## Apps

This file covers the public site, the only app in `apps/web`. It is a fork of the base template's web app, and `saasaloy update` never reaches it. `brand.css` holds the tokens recorded here, `web.css` imports it and adds the page's layout, type and motion vocabulary, and `globals.css` holds the shared Tailwind setup with no token values.

## Colors

Cobalt `primary` (#315fe8) is the one chromatic colour, and both themes use it for solid buttons with white labels. The light theme is pale paper (#f6f7f9) with navy text (#0b2253) and gray prose (#626b78). The dark theme is deep navy (#101722) with off-white text (#eef2f8), pale blue (#8fa8ff) and muted prose (#a9b5c7).

`highlight` is the colour of section titles, the wordmark, technical labels and line art. It is cobalt in light and pale blue in dark, because cobalt on deep navy is too dark to read as text. The hero's first sentence uses `foreground`, and its second sentence uses `highlight`.

The plan supplies the eight values above. The other roles are derived from them, so the palette has no colour of its own outside that set:

- `border` mixes 22% cobalt into the light paper, and `dark-border` mixes 25% pale blue into the dark navy.
- `muted` mixes 6% cobalt into the paper, and `dark-muted` mixes 10% pale blue into the navy. The active stage row uses these.
- `secondary` mixes 10% cobalt into white, and `dark-secondary` mixes 14% pale blue into the navy. Type tags and the secondary button use these.
- `card` is white in light. `dark-card` mixes 5% pale blue into the navy, so a surface in dark is never a white island.
- `ring` is the theme's `highlight`.
- `destructive` keeps the base seed values. The page has no danger state, and the token exists only for the shared primitives.

Use the semantic custom properties in `apps/web/src/styles/brand.css`. Do not copy hex values into components. Do not add green, orange, purple or lime. The catalog type tags in the mockup carry some of these colours, and the manifest records that as an image tool limitation, not a design choice. Every tag uses the `type-tag` pair.

## Typography

The site self-hosts two faces through `@fontsource` packages with `font-display: swap`. Geist carries headlines, prose and controls. Geist Mono carries every command, module name, path, environment value, stage description and diagram label. The split tells the reader what to type and what to read.

Headlines are bold with tight tracking. `text-display` is the hero's one `h1`, fluid from `2.5rem` to `4.5rem`. `text-section-title` is every section's `h2`, fluid from `2rem` to `3rem`. The token map records the largest size of each fluid step. `text-lead` is the sans paragraph under either title, in `muted-foreground`. Body copy uses `body-sm` through `body-lg`. Mono text uses `code-md` in the command field and the catalog rows, and `code-sm` in tabs, tags and diagram callouts.

The wordmark is the lowercase word `saasaloy` in Geist, in `highlight`. The footer repeats it at section-title size.

## Layout

Every section is two columns on desktop, with copy in one column and a line-art illustration in the other. The illustration alternates sides down the page: right in the hero, left in stages, right in the catalog, left in providers, right in this site and left in the FAQ, where the repository tree sits beside the accordion. On mobile the columns stack, copy first.

One container width lives in `web.css`: every section, the navbar and the footer use `section-container-wide` at `80rem`, with a `1.5rem` gutter. `section-y` is the one vertical rhythm between sections: `3rem` on small screens and `4rem` from `48rem` up, which keeps the page near the density of the round 10 mockup. A block uses these names and sets no width or section padding of its own.

A full-width blueprint rule separates the sections. It is a hairline in `border` with a small crosshair at each end and short tick marks along it. The navbar sits above the first rule: the wordmark on the left, then Docs, GitHub, Guide and the theme toggle on the right. The graph-paper grid runs behind the whole page as one continuous background, so no section draws a band of its own.

Components use Tailwind's default spacing scale, which stays omitted from the token map.

## Elevation & Depth

The page is flat. Hairline borders and tonal surfaces separate content, and nothing casts a shadow. The dark theme adds no glow and no gradient. Depth exists only inside the isometric illustrations, which draw it with line work, not with CSS.

## Shapes

Corners are square. Every frame, button, command field, tab, tag, tile and accordion row uses `rounded.none`. The one round shape is the stage marker, a `rounded.full` circle that holds the stage number. Do not add a radius between these two values.

## Components

The landing page has seven sections in this order: hero, stages, catalog, providers, this site, FAQ and footer. Each section opens with a `section-title`, except the hero, which uses `hero-title`.

- **Hero.** The headline reads "A landing page today. Your next module tomorrow." A `lead` follows. Under it, the command field holds `npx saasaloy init my-app`, joined to a solid Copy button. Two inline links follow, Getting started and GitHub, each with an icon and a trailing arrow and a hairline divider between them. A `body-small` note under the links says the project is a proof of concept. The illustration is an isometric application wireframe with a sign-in panel, source files, a database and an email service.
- **Stages.** A vertical list of five numbered stages on a hairline: landing page, waitlist, sign-in, teams and payments. Each stage has a title and a mono description. The active stage fills its marker with `primary` and tints its row with `muted`. The illustration is an exploded stack of source slabs in the same order, and the active slab fills with `primary`.
- **Catalog.** The heading and the filter tabs sit beside the module drawing, and a full-width grid of module tiles sits below them, four across on desktop. Each tile shows the name, the type tag and the description. The active tab is solid `primary`, and the others are outlined. Tiles share hairline borders and have no shadow or zebra fill. The module list comes from `modules/*/registry-item.json` at build time.
- **Providers.** One capability connects to three interchangeable provider modules, with a small `.env` panel that shows the selecting variable. Short callouts in `highlight` name the point of each part.
- **This site.** A `lead`, the command field again, and an outlined secondary button that links to the site source.
- **FAQ.** Bordered accordion rows with a chevron. The question is in `highlight`, and the open answer is in `muted-foreground`.
- **Footer.** The large wordmark, the tagline "Start small. Own the source.", and links to GitHub, Getting started, Changelog and the MIT license in `highlight`.

The command field is the page's primary call to action. It is a bordered mono field with a prompt glyph, and a solid `primary` Copy button sits flush against its right edge. Both share the `2.5rem` height and square corners. The copy button shows its copied state in place and never moves the layout.

Illustrations are line art in `highlight` on the page background, with mono callouts on leader lines. One element per illustration fills with `primary` to mark the focus. Draw them as SVG so the stroke colour follows the theme tokens.

Cards in one row share one height. The grid stretches its cards, so it carries no `items-start`, and sibling cards hold the same number of one-line items. A card's primary action sits inside that card, on the primary button.

The `error-state` block is the 404 and 500 screen. It is a single bordered frame holding a muted icon, a status label in `code-sm`, a title, a description in `muted-foreground`, and one or two actions on the button scale. It carries no destructive token and no alert tint, because a mistyped address is not a danger state.

## Do's and Don'ts

- Read this file, `apps/web/src/styles/brand.css` and `apps/web/src/styles/web.css` before you write UI.
- Use semantic token utilities such as `bg-primary`, `text-highlight` and `text-muted-foreground`.
- Keep light and dark token pairs together when you change a semantic role.
- Do not add a colour, radius, shadow, or type size that this file does not define.
- Do not add a shadow, a glow or a gradient. Use a hairline or a tonal surface.
- Do not round a corner, except the stage marker.
- Put commands, module names, paths and environment values in Geist Mono.
- Keep UI copy short and literal. Every claim on the site must also appear in the README, and the proof-of-concept note stays visible.
- Do not put a value in copy that goes stale: a version number, a release date, a count. Link to where the current value lives.
- Open every link that leaves the site in a new tab. Spread `externalLinkProps(href)` from `@web/lib/external-link` onto the anchor and render `newTabHint(href)` inside it. A path on this site or a same-page anchor stays in the tab.

## Motion

Motion is CSS only and additive. With reduced motion requested, or in a browser that lacks the feature, every element sits in its final state. The page keeps seven named utilities in `web.css`, and they are the whole vocabulary: `blur-in` (the hero's load-time cascade, staggered with `--blur-in-delay`), `reveal` (a scroll-tied entrance below the fold, on every section heading and every drawing), `nav-float` (the navbar frosts and gains its bottom hairline once the page scrolls), `hover-lift` (a 2px rise under a fine pointer, with no shadow), `press` (a solid control shrinks to 0.97 while held), `appear` (an element settles in over 200ms when it starts to render, so a catalog filter brings its tiles in) and `disclosure` (a FAQ answer opens and closes over its height in 200ms). Blocks use these names and write no keyframes. Color and state changes use short Tailwind transitions, and so do two small swaps that need no name: the mobile menu panel settles down 4px as it opens, and the copy button's icon grows in from 75% when it changes. Interface motion stays at or under 200ms on `--ease-out-soft`. A theme toggle press reveals the new theme as a circle that grows from the button, through a view transition whose animation lives in `globals.css`. The script only starts it, and reduced motion skips it.

Phase 5 deleted `beam-in`, `marquee` and `shine-text`: the first broke the no-glow rule, and the other two belonged to blocks the page dropped. Do not bring them back. Motion stays in prose because the DESIGN.md alpha schema has no motion token group.

## Dark Mode

Dark is the brand's lead palette. The `.dark` class selects the dark token set. The pre-paint theme script applies the class before rendering and records the resolved mode in `data-theme`. Components must use semantic tokens so both themes stay aligned. In dark, every surface stays navy, including the wireframe panels inside an illustration.

The theme toggle has two states, light and dark. `system` is only the starting state: a visitor who never pressed the toggle follows the OS. A press flips the resolved mode and stores the choice, and no press steps back to `system`. Do not add a third state or a light/dark/system menu to the toggle.

_Supplied from the round 10 mockup and plan 0091 on `issue-287-add-a-public-site-and-design-system`@`6ec0613c` on 2026-10-26._
