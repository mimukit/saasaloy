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
    fontSize: 3.75rem
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.025em
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
    typography: "{typography.headline-lg}"
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

## Colors

The light theme uses white surfaces, near-black text, and a dark neutral primary action. The dark theme reverses that relationship with near-black surfaces and near-white text. Muted neutrals separate supporting content. The destructive color is the only chromatic semantic token in the seed.

Use the semantic custom properties in `packages/ui/src/styles/globals.css`. Do not copy their current `oklch()` values into components.

## Typography

The template uses Tailwind's system sans stack. Marketing headings use semibold weight, tight tracking, and the `text-3xl` through `text-6xl` scale. Body copy uses the `text-sm` through `text-lg` scale. Controls use medium weight at `text-xs` or `text-sm`.

## Layout

Pages use centered maximum-width containers. Sections use responsive horizontal padding and large vertical gaps. Components use Tailwind's default spacing scale, which stays omitted from the token map because the project does not define a custom scale.

## Elevation & Depth

Surfaces use borders, rings, and tonal contrast instead of a shadow scale. The small shadow on the input is a component detail. Do not infer a project shadow scale from it.

## Shapes

The base radius is `0.625rem`. Controls use the `lg` radius. Cards use `xl`. Large callouts use `2xl`. Badges use `4xl` for a pill shape.

## Components

Primary buttons use the primary pair. Secondary buttons use the secondary pair. Destructive actions use the destructive token with restrained tint states. Inputs and buttons share a `2rem` default height and the `lg` radius. Cards use the card pair and a border-strength ring.

## Do's and Don'ts

- Read this file and `packages/ui/src/styles/globals.css` before you write UI.
- Use semantic token utilities such as `bg-primary` and `text-muted-foreground`.
- Keep light and dark token pairs together when you change a semantic role.
- Keep new pages within the established type scale and radius vocabulary.
- Do not add a color, radius, shadow, or type size that the code does not define.
- Do not use a shadow when a border or tonal surface provides the needed separation.
- Keep UI copy direct and specific. Use the product brief for product language.

## Motion

The template uses short Tailwind transitions for color and state changes. Accordion motion uses the animation supplied by the vendored primitive. Motion stays in prose because the DESIGN.md alpha schema has no motion token group.

## Dark Mode

The `.dark` class selects the dark token set. The pre-paint theme script applies the class before rendering and records the resolved mode in `data-theme`. Components must use semantic tokens so both themes stay aligned.

_Seeded from the saasaloy base template · CLI {{CLI_VERSION}} · tokens sha256:101fd7fd684f of packages/ui/src/styles/globals.css_
