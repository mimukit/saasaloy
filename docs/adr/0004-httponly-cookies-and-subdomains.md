# 0004 — httpOnly session cookies + subdomains

Auth uses Better Auth httpOnly session cookies scoped to `.x.com` across a three-app subdomain topology — `x.com` (marketing) · `app.x.com` (admin SPA) · `api.x.com` (Hono API) — with the SPA calling the API `credentials: 'include'` and CORS allowing the app origin. This is the most secure shape (nothing stealable from JS, revocable), the least code, and the standard SaaS pattern. See build-spec [§2.5](../plans/saasaloy-build-spec.md).

## Status
accepted — supersedes the draft's JWT/stateless default

## Considered Options
- JWT / stateless auth — rejected: the edge-portability rationale died with the all-in-Cloudflare commitment ([ADR-0001](0001-all-in-on-cloudflare.md)), and a client-only SPA has no server to hold a JWT (so it lands in `localStorage`, XSS-exposed, or in-memory with a refresh dance).

## Consequences
- A D1 session read per request is negligible; the draft's "DB sessions lack edge compat" worry does not apply — D1 is a binding and Better Auth's Drizzle adapter reads it at the edge fine.
- The admin app is deliberately TanStack Router (SPA), not Start — an SPA never asks Workers to render it, sidestepping the "fullstack TanStack Start + Workers + D1 not cleanly generatable" issue.
