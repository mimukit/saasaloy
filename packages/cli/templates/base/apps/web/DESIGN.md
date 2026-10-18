---
version: alpha
name: "{{PROJECT_NAME}}"
description: "The neutral, content-first design system shipped by the Saasaloy base template."
omitted:
  - section: spacing
    reason: "Tailwind's default scale is used unchanged"
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.97 0 0)"
  secondary-foreground: "oklch(0.205 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  dark-background: "oklch(0.145 0 0)"
  dark-foreground: "oklch(0.985 0 0)"
  dark-card: "oklch(0.205 0 0)"
  dark-card-foreground: "oklch(0.985 0 0)"
  dark-primary: "oklch(0.922 0 0)"
  dark-primary-foreground: "oklch(0.205 0 0)"
  dark-secondary: "oklch(0.269 0 0)"
  dark-secondary-foreground: "oklch(0.985 0 0)"
  dark-muted-foreground: "oklch(0.708 0 0)"
  dark-destructive: "oklch(0.704 0.191 22.216)"
typography:
  headline-display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 4.5rem
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: -0.035em
  headline-section:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 2.25rem
    fontWeight: 600
    lineHeight: 2.5rem
    letterSpacing: -0.025em
  headline-md:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.875rem
    fontWeight: 600
    lineHeight: 2.25rem
    letterSpacing: -0.025em
  body-lg:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.75rem
  lead:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.75rem
  body-md:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  body-sm:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  label-md:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  label-sm:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1rem
rounded:
  sm: 0.375rem
  md: 0.5rem
  lg: 0.625rem
  xl: 0.875rem
  2xl: 1rem
  4xl: 2rem
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-md}"
  page-dark:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-foreground}"
  hero-title:
    textColor: "{colors.foreground}"
    typography: "{typography.headline-display}"
  section-title:
    textColor: "{colors.foreground}"
    typography: "{typography.headline-section}"
  section-lead:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.lead}"
  legal-title:
    textColor: "{colors.foreground}"
    typography: "{typography.headline-md}"
  body-large:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body-lg}"
  body-small:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body-sm}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    height: 2rem
  button-primary-dark:
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
  button-secondary-dark:
    backgroundColor: "{colors.dark-secondary}"
    textColor: "{colors.dark-secondary-foreground}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.primary-foreground}"
  destructive-text-dark:
    textColor: "{colors.dark-destructive}"
  input:
    textColor: "{colors.foreground}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    height: 2rem
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
  card-dark:
    backgroundColor: "{colors.dark-card}"
    textColor: "{colors.dark-card-foreground}"
  callout:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.2xl}"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.4xl}"
  focus-ring:
    backgroundColor: "{colors.ring}"
  border:
    backgroundColor: "{colors.border}"
  muted-text-dark:
    textColor: "{colors.dark-muted-foreground}"
---

# {{PROJECT_NAME}} Design System

## Overview

The base uses a neutral, content-first system. It gives a new product a clear structure without choosing a brand palette for the owner. Product identity enters through the theme tokens, the product brief, and the copy.

## Apps

This file covers the web app. Each app has its own theme file in `packages/ui/src/styles/` and its own `DESIGN.md` in its own folder. `web.css` holds the tokens recorded here, and `globals.css` holds the shared Tailwind setup with no token values. Another app's theme file imports `globals.css` and declares its own tokens, mapping and radius scale, so a change here never reaches it.

## Colors

The light theme uses white surfaces, near-black text, and a dark neutral primary action. The dark theme reverses that relationship with near-black surfaces and near-white text. Muted neutrals separate supporting content. The destructive color is the only chromatic semantic token in the seed.

Use the semantic custom properties in `packages/ui/src/styles/web.css`. Do not copy their current `oklch()` values into components.

## Typography

The template uses Tailwind's system sans stack, with no web font. Three named sizes in `web.css` carry the landing page's ramp. `text-display` is the hero's one `h1`: medium weight, very tight tracking, and fluid from `2.5rem` to `4.5rem`. `text-section-title` is every section's `h2`: semibold, tight, fluid from `2rem` to `3rem`. `text-lead` is the paragraph under either. The token map records the largest size of each fluid step. Body copy uses the `text-sm` through `text-lg` scale. Controls use medium weight at `text-xs` or `text-sm`. Code the page quotes (commands, module names, paths) uses the mono face at `text-xs` or the surrounding size.

## Layout

Three container widths live in `web.css`. `section-container` is every section's frame at `64rem`. `section-container-narrow` is a deliberate `48rem` reading measure for the FAQ and the closing CTA. `section-container-wide` is `80rem`, for the navbar and the hero's product frame. All three share a `1.5rem` gutter. `section-y` is the one vertical rhythm between sections: `5rem` on small screens and `8rem` from `48rem` up. A block uses these names and sets no width or section padding of its own, so sections can be added, removed and reordered without the spacing drifting. Components use Tailwind's default spacing scale, which stays omitted from the token map because the project does not define a custom scale.

## Elevation & Depth

Surfaces use borders, rings, and tonal contrast instead of a shadow scale. Landing cards add a hairline `shadow-xs`. Two elements carry a soft drop shadow tinted from `foreground`: the hero's product frame and the featured pricing tier. Those are the page's only raised surfaces. The small shadow on the input is a component detail. Do not infer a project shadow scale from any of them.

## Shapes

The base radius is `0.625rem`. Controls use the `lg` radius. Cards use `xl`. Large callouts use `2xl`. Badges use `4xl` for a pill shape.

## Components

The landing page is thirteen blocks in `packages/ui/src/blocks/`, composed by explicit imports in `apps/web/src/pages/index.astro`: navbar, hero, logo-cloud, pain-points, how-it-works, feature-grid, showcase, audience, testimonials, pricing-table, faq, cta and footer. They share one vocabulary. A section opens with a centred `section-title` and `lead`. Cards are bordered at the `xl` radius. A product visual sits in a double frame: an outer bordered shell at `1.25rem` and an inner surface at `0.875rem`. Primary calls to action sit in a thin ringed wrapper beside a ghost button. Decoration is drawn from tokens: the `grid-pattern` utility under a radial mask, and a dashed rule for dividers inside a card and above the footer.

Primary buttons use the primary pair. Secondary buttons use the secondary pair. Destructive actions use the destructive token with restrained tint states. Inputs and buttons share a `2rem` default height and the `lg` radius. Cards use the card pair and a border-strength ring.

The `error-state` block is the one screen for a failure: a wrong path, a failed render, a server error. It is a single centered card holding a muted icon, a status label in the mono face at the smallest size, a title at `body-lg`, a description in `muted-foreground`, and one or two actions on the button scale. It carries no destructive token and no alert tint, because a mistyped address is not a danger state. Every app renders this block rather than its own error markup, so a theme change reaches all three at once.

## Do's and Don'ts

- Read this file and `packages/ui/src/styles/web.css` before you write UI.
- Use semantic token utilities such as `bg-primary` and `text-muted-foreground`.
- Keep light and dark token pairs together when you change a semantic role.
- Keep new pages within the established type scale and radius vocabulary.
- Do not add a color, radius, shadow, or type size that the code does not define.
- Do not use a shadow when a border or tonal surface provides the needed separation.
- Keep UI copy direct and specific. Use the product brief for product language.

## Motion

Motion is CSS only and additive. With reduced motion requested, or in a browser that lacks the feature, every element sits in its final state. The named utilities in `web.css` are the whole vocabulary: `blur-in` (the hero's load-time cascade, staggered with `--blur-in-delay`), `reveal` (a scroll-tied entrance below the fold), `marquee` (the logo row), `shine-text` (the announcement pill), `nav-float` (the navbar frosting once the page scrolls) and `hover-lift`. Blocks use these names and write no keyframes. Color and state changes use short Tailwind transitions. Motion stays in prose because the DESIGN.md alpha schema has no motion token group.

## Dark Mode

The `.dark` class selects the dark token set. The pre-paint theme script applies the class before rendering and records the resolved mode in `data-theme`. Components must use semantic tokens so both themes stay aligned.

_Seeded from the saasaloy base template · CLI {{CLI_VERSION}} · tokens sha256:c608f76223c0 of packages/ui/src/styles/web.css_
